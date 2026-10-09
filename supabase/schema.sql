-- Pay Attention To Me — Supabase schema
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run.

-- ---------- tables ----------

create table if not exists public.pairs (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 24),
  avatar_url    text,
  pair_id       uuid references public.pairs (id) on delete set null,
  last_poke_at  timestamptz,
  mood          text not null default 'happy' check (mood in ('happy', 'angry', 'sad')),
  created_at    timestamptz not null default now()
);
create index if not exists profiles_pair_id_idx on public.profiles (pair_id);

-- The octopus mood toy. Added after the first release, so existing projects
-- pick it up by re-running this file.
alter table public.profiles add column if not exists mood text not null default 'happy';
do $$ begin
  alter table public.profiles add constraint profiles_mood_check check (mood in ('happy', 'angry', 'sad'));
exception when duplicate_object then null; end $$;

create table if not exists public.push_subscriptions (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  endpoint      text not null unique,
  subscription  jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create table if not exists public.pokes (
  id          bigint generated always as identity primary key,
  pair_id     uuid not null references public.pairs (id) on delete cascade,
  from_user   uuid references public.profiles (id) on delete set null,
  level       smallint not null check (level between 1 and 9),
  created_at  timestamptz not null default now()
);
create index if not exists pokes_pair_created_idx on public.pokes (pair_id, created_at desc);

-- ---------- security ----------
-- All reads/writes go through the Node server using the secret (service role) key,
-- which bypasses RLS. RLS on with no policies = the public/anon key can't touch anything.
alter table public.pairs              enable row level security;
alter table public.profiles           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.pokes              enable row level security;

-- ---------- atomic join ----------
-- Locks the pair row so two people can't both become the 2nd member at once.
create or replace function public.join_pair(p_user uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair      uuid;
  v_old_pair  uuid;
  v_count     int;
begin
  select id into v_pair from pairs where code = upper(trim(p_code)) for update;
  if v_pair is null then
    raise exception 'NO_PAIR';
  end if;

  select pair_id into v_old_pair from profiles where id = p_user for update;
  if v_old_pair = v_pair then
    return v_pair; -- already in it
  end if;

  select count(*) into v_count from profiles where pair_id = v_pair;
  if v_count >= 2 then
    raise exception 'PAIR_FULL';
  end if;

  -- refuse if you're already paired with someone else
  if v_old_pair is not null and
     (select count(*) from profiles where pair_id = v_old_pair) > 1 then
    raise exception 'ALREADY_PAIRED';
  end if;

  update profiles set pair_id = v_pair where id = p_user;

  -- clean up the solo pair you were waiting in
  if v_old_pair is not null then
    delete from pairs where id = v_old_pair;
  end if;

  return v_pair;
end;
$$;

-- Leave your pair; deletes the pair if nobody is left in it.
create or replace function public.leave_pair(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair uuid;
begin
  select pair_id into v_pair from profiles where id = p_user for update;
  if v_pair is null then return; end if;
  update profiles set pair_id = null where id = p_user;
  if not exists (select 1 from profiles where pair_id = v_pair) then
    delete from pairs where id = v_pair;
  end if;
end;
$$;

-- Only the server (service role) may call these.
revoke all on function public.join_pair(uuid, text) from public, anon, authenticated;
revoke all on function public.leave_pair(uuid)      from public, anon, authenticated;
grant execute on function public.join_pair(uuid, text) to service_role;
grant execute on function public.leave_pair(uuid)      to service_role;

-- ---------- poke levels ----------
-- 1-3 the original attacks, 4 MWAH, 5 love shower, 6-9 the four combos.
-- Older installs were created with "between 1 and 3", so widen it (safe to re-run).
alter table public.pokes drop constraint if exists pokes_level_check;
alter table public.pokes add constraint pokes_level_check check (level between 1 and 9);
