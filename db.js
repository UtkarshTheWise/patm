// All Supabase access lives here. The server uses the SECRET key (bypasses RLS);
// the browser only ever gets the publishable key, which RLS blocks from every table.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Copy .env.example to .env and fill it in.");
}

const sb = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const newCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");

// Verify a Supabase access token (from Google sign-in) and return the auth user.
async function userFromToken(token) {
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// Make sure a profile row exists. Name comes from the Google account on first sign-in.
async function ensureProfile(user) {
  const meta = user.user_metadata || {};
  const name = (meta.given_name || meta.full_name || meta.name || user.email?.split("@")[0] || "You")
    .toString().trim().slice(0, 24) || "You";
  must(await sb.from("profiles").upsert(
    { id: user.id, name, avatar_url: meta.avatar_url || meta.picture || null },
    { onConflict: "id", ignoreDuplicates: true } // don't overwrite a name they changed
  ));
  return must(await sb.from("profiles").select("*").eq("id", user.id).single());
}

async function getProfile(userId) {
  return must(await sb.from("profiles").select("*").eq("id", userId).maybeSingle());
}

async function updateName(userId, name) {
  must(await sb.from("profiles").update({ name }).eq("id", userId));
}

const MOODS = ["happy", "angry", "sad"];

// The mood column arrived after the first release. Reads degrade on their own
// (the field is simply absent), so we only have to notice a failing write once.
let hasMoodColumn = true;
async function updateMood(userId, mood) {
  if (!MOODS.includes(mood)) throw new AppError(400, "Unknown mood");
  if (!hasMoodColumn) return false;
  const { error } = await sb.from("profiles").update({ mood }).eq("id", userId);
  if (!error) return true;
  // 42703 = undefined column; PGRST204 = not in PostgREST's schema cache
  if (error.code === "42703" || error.code === "PGRST204") {
    hasMoodColumn = false;
    console.warn("profiles.mood is missing — re-run supabase/schema.sql to enable the mood toy.");
    return false;
  }
  throw error;
}

async function getPartner(profile) {
  if (!profile?.pair_id) return null;
  const rows = must(await sb.from("profiles").select("*")
    .eq("pair_id", profile.pair_id).neq("id", profile.id).limit(1));
  return rows[0] || null;
}

async function getPair(pairId) {
  if (!pairId) return null;
  return must(await sb.from("pairs").select("*").eq("id", pairId).maybeSingle());
}

// Create a fresh pair (with a share code) for a user who isn't paired with anyone yet.
async function createPair(profile) {
  if (profile.pair_id) {
    const partner = await getPartner(profile);
    if (partner) throw new AppError(409, "You're already paired. Leave first.");
    return getPair(profile.pair_id); // already waiting in a solo pair — reuse its code
  }
  for (let i = 0; i < 5; i++) {
    const { data, error } = await sb.from("pairs").insert({ code: newCode() }).select().single();
    if (error?.code === "23505") continue; // code collision, try another
    if (error) throw error;
    must(await sb.from("profiles").update({ pair_id: data.id }).eq("id", profile.id));
    return data;
  }
  throw new AppError(500, "Couldn't generate a code, try again");
}

async function joinPair(userId, code) {
  const { error } = await sb.rpc("join_pair", { p_user: userId, p_code: code });
  if (!error) return;
  const msg = error.message || "";
  if (msg.includes("NO_PAIR")) throw new AppError(404, "No one with that code");
  if (msg.includes("PAIR_FULL")) throw new AppError(409, "That pair is already full");
  if (msg.includes("ALREADY_PAIRED")) throw new AppError(409, "You're already paired. Leave first.");
  throw error;
}

async function leavePair(userId) {
  must(await sb.rpc("leave_pair", { p_user: userId }));
}

async function deleteAccount(userId) {
  await leavePair(userId);
  const { error } = await sb.auth.admin.deleteUser(userId); // cascades to profile, subs
  if (error) throw error;
}

// Returns false if the user poked too recently.
async function claimPokeSlot(profile, cooldownMs) {
  const now = Date.now();
  const last = profile.last_poke_at ? Date.parse(profile.last_poke_at) : 0;
  if (now - last < cooldownMs) return false;
  // Conditional update so two fast taps can't both pass
  let q = sb.from("profiles").update({ last_poke_at: new Date(now).toISOString() }).eq("id", profile.id);
  q = profile.last_poke_at ? q.eq("last_poke_at", profile.last_poke_at) : q.is("last_poke_at", null);
  const rows = must(await q.select("id"));
  return rows.length === 1;
}

async function addPoke(pairId, fromUser, level) {
  const { error } = await sb.from("pokes").insert({ pair_id: pairId, from_user: fromUser, level });
  if (!error) return;
  // 23514 = check violation: the level column still only allows 1-3 on an older schema.
  if (error.code === "23514") throw new AppError(503, "New moves need the latest supabase/schema.sql. Re-run it.");
  throw error;
}

async function recentPokes(pairId, limit = 10) {
  if (!pairId) return [];
  return must(await sb.from("pokes").select("from_user, level, created_at")
    .eq("pair_id", pairId).order("created_at", { ascending: false }).limit(limit));
}

async function saveSubscription(userId, sub) {
  must(await sb.from("push_subscriptions").upsert(
    { user_id: userId, endpoint: sub.endpoint, subscription: sub },
    { onConflict: "endpoint" }
  ));
}

async function getSubscriptions(userId) {
  return must(await sb.from("push_subscriptions").select("endpoint, subscription").eq("user_id", userId));
}

async function hasSubscription(userId) {
  const { count, error } = await sb.from("push_subscriptions")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  return count > 0;
}

async function deleteSubscription(endpoint) {
  must(await sb.from("push_subscriptions").delete().eq("endpoint", endpoint));
}

module.exports = {
  AppError, MOODS, userFromToken, ensureProfile, getProfile, updateName, updateMood, getPartner, getPair,
  createPair, joinPair, leavePair, deleteAccount, claimPokeSlot, addPoke, recentPokes,
  saveSubscription, getSubscriptions, hasSubscription, deleteSubscription,
};
