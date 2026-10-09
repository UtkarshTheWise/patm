// Pay Attention To Me — client
// Sign-in: Google via Supabase Auth. Every API call sends the Supabase access token,
// which the server verifies before touching the database.
// All motion goes through UI (ui.js); all art comes from SPRITES (sprites.js);
// the seabed and camera are WORLD (world.js).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let sb = null; // Supabase client (auth only — no direct table access from the browser)
let config = null; // { supabaseUrl, supabaseKey, vapidPublicKey }
let state = null; // last /api/me response
let pollTimer = null;
let skew = 0; // server clock minus ours, so "recent" timestamps compare correctly

// Everything you can send. cd is how long you wait afterwards (matches the server).
// 1-4 are buttons; 5 is the shower an MWAH streak unlocks; 6 is what the combo's last move becomes.
const MOVES = {
  1: { name: "Need attention", hit: "It landed softly.", cd: 5000 },
  2: { name: "Thinking of you", hit: "It was sweet!", cd: 5000 },
  3: { name: "Missing you", hit: "It's super effective!", cd: 5000 },
  4: { name: "MWAH", hit: "Smooch delivered.", cd: 3000 },
  5: { name: "Love shower", hit: "Their screen fills with hearts when they open the app.", cd: 5000 },
  6: { name: "Triple threat", hit: "Critical hit!", cd: 5000 },
};
const COMBO = [1, 3, 2]; // need attention, then missing you, then thinking of you
const COMBO_WINDOW_MS = 60_000;
const SHOWER_NEEDS = 8; // MWAHs in a row-ish to unlock the shower
const SHOWER_WINDOW_MS = 60_000;
const ATTENTION_DECAY_MS = 6 * 60 * 60 * 1000;
const FRESH_MS = 12 * 60 * 60 * 1000; // don't replay incoming moves older than this
const SEEN_KEY = "patm-seen";
const MOODS = ["happy", "angry", "sad"];

let myMood = "happy";
let cooldownUntil = 0;
let cdTimer = null;
let sending = false;
let moodTimer = null;
let drawn = { me: null, foe: null };
let exprTimer = { me: null, foe: null };
let idling = false;
let firstHome = true;
let lastPartnerMood = null;

// ---------- helpers ----------
const now = () => Date.now() + skew;

async function api(path, body) {
  const { data } = await sb.auth.getSession(); // refreshes the token if it expired
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(json.error || "Something went wrong"), {
      status: res.status,
    });
  return json;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}

let screen = null;
function show(id) {
  UI.showScreen(id);
  if (id === screen) return; // render() calls this on every refresh; only react to a real change
  screen = id;
  stopPolling();
  if (id === "waiting") startPolling(3000);
  if (id === "home") {
    startPolling(6000);
    WORLD.measure();
    requestAnimationFrame(WORLD.measure);
  }
}

function ago(ts) {
  const s = Math.round((now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function busy(btn, fn) {
  UI.press(btn);
  btn.disabled = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  navigator.standalone === true;
const pushSupported =
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// ---------- the two fighters ----------
function say(text, opts) {
  return UI.type($("#msg"), text, opts);
}

function idlePrompt() {
  say(`What will ${state?.name || "you"} do?`, { instant: true });
}

// How much attention someone has had lately: full right after a poke,
// fading back down over a few hours. Purely a feel-good read on `recent`.
function attention(fromMe) {
  const last = (state?.recent || []).find((p) => p.fromMe === fromMe);
  if (!last) return 6;
  const left = 1 - (now() - last.at) / ATTENTION_DECAY_MS;
  return Math.max(6, Math.min(100, Math.round(left * 100)));
}

const spriteEl = (which) => $(which === "me" ? "#sprite-me" : "#sprite-foe");

// Draw a fighter. The face slides toward the opponent so they look at each other.
function paintSprite(which, mood, expr) {
  const e = expr || "idle";
  const key = `${mood}|${e}`;
  if (drawn[which] === key) return;
  drawn[which] = key;
  const el = spriteEl(which);
  el.innerHTML = `<div class="lean">${SPRITES.octopus(mood, { look: which === "me" ? 1 : -1, expr: e })}</div>`;
  const m = SPRITES.MOOD[mood];
  const chip = $(which === "me" ? "#me-mood-label" : "#foe-mood-label");
  chip.textContent = m.label;
  chip.style.setProperty("--mood", m.ui);
  if (which === "me") {
    el.setAttribute("aria-label", `Your mood: ${m.label.toLowerCase()}. Tap to flip it.`);
  }
}

// A quick facial expression (kiss, ouch) that settles back to the mood face.
function setExpr(which, expr, ms) {
  const mood = which === "me" ? myMood : MOODS.includes(state?.partnerMood) ? state.partnerMood : "happy";
  paintSprite(which, mood, expr);
  clearTimeout(exprTimer[which]);
  exprTimer[which] = setTimeout(() => { exprTimer[which] = null; paintSprite(which, mood, "idle"); }, ms);
}

// How the target reacts to a move: heart eyes for the sweet ones, a startle for the pushy ones,
// dizzy stars for the combo. A grumpy octopus gets flustered by a kiss instead of melting.
function reaction(level, mood) {
  if (level === 6) return { face: "dizzy", emote: "dizzy" };
  if (level === 1) return { face: "shock", emote: "shock" };
  if (level === 4 && mood === "angry") return { face: "shock", emote: "shock" };
  return { face: "love", emote: "love" };
}
// Both sides play it: the target reacts, the sender cheers (or puckers) at having landed it.
function exchange(from, to, level) {
  const mood = (w) => (w === "me" ? myMood : MOODS.includes(state?.partnerMood) ? state.partnerMood : "happy");
  const r = reaction(level, mood(to));
  setExpr(to, r.face, 1000);
  UI.emote($("#fx"), spriteEl(to), r.emote);
  setExpr(from, level === 4 ? "mwah" : "cheer", 900);
}

// Idle life: now and then one of them hops and the other notices. Mood decides the flavour.
function ambientGlance() {
  const wait = 6000 + Math.random() * 6000;
  setTimeout(() => {
    if (!document.hidden && !$("#home").hidden && !sending) {
      const who = Math.random() < 0.5 ? "me" : "foe", other = who === "me" ? "foe" : "me";
      const m = who === "me" ? myMood : state?.partnerMood;
      UI.hop(spriteEl(who), 10);
      if (!exprTimer[who]) setExpr(who, m === "angry" ? "idle" : "cheer", 800);
      setTimeout(() => {
        UI.emote($("#fx"), spriteEl(who), m === "angry" ? "shock" : "giggle");
        if (!exprTimer[other]) setExpr(other, m === "angry" ? "shock" : "love", 800);
      }, 350);
    }
    ambientGlance();
  }, wait);
}

function startIdle() {
  if (idling) return;
  idling = true;
  UI.idle(spriteEl("me"), { duration: 1.6 });
  UI.idle(spriteEl("foe"), { duration: 2.0, delay: 0.4 });
}

// ---------- combo + shower bookkeeping ----------
const mine = () => (state?.recent || []).filter((p) => p.fromMe); // newest first

// 0, 1 or 2 moves of the triple threat already landed (and still fresh).
function comboProgress() {
  const [a, b] = mine();
  if (a && a.level === COMBO[1] && b && b.level === COMBO[0] && now() - b.at <= COMBO_WINDOW_MS) return 2;
  if (a && a.level === COMBO[0] && now() - a.at <= COMBO_WINDOW_MS) return 1;
  return 0;
}

// MWAHs sent since the last shower, inside the window.
function kissCount() {
  let n = 0;
  for (const p of mine()) {
    if (p.level === 5) break;
    if (now() - p.at > SHOWER_WINDOW_MS) break;
    if (p.level === 4) n++;
  }
  return n;
}

function paintDock() {
  if (!state?.paired) return;
  const prog = comboProgress();
  $$(".combo-steps li[data-step]").forEach((li) => li.classList.toggle("on", Number(li.dataset.step) <= prog));
  $("#combo").classList.toggle("ready", prog === 2);

  const k = Math.min(kissCount(), SHOWER_NEEDS);
  $$("#streak i").forEach((i, n) => i.classList.toggle("on", n < k));
  $("#streak").classList.toggle("full", k >= SHOWER_NEEDS);

  const pop = $("#shower-pop");
  const want = k >= SHOWER_NEEDS;
  if (want && pop.hidden) {
    pop.hidden = false;
    UI.pop(pop, { from: 0.4 });
    navigator.vibrate?.([40, 30, 40]);
    say("Your kisses are overflowing. Shower them with love?");
  } else if (!want && !pop.hidden) pop.hidden = true;
}
setInterval(() => { if (!document.hidden && !$("#home").hidden) paintDock(); }, 1000);

// ---------- cooldown ----------
function setCooling(ms) {
  clearTimeout(cdTimer);
  cooldownUntil = Date.now() + ms;
  for (const m of $$(".move")) {
    m.classList.remove("cool");
    m.style.setProperty("--cd", ms + "ms");
    void m.offsetWidth; // restart the drain animation
    m.classList.add("cool");
    m.setAttribute("aria-disabled", "true");
  }
  $("#shower-pop").classList.add("cool");
  cdTimer = setTimeout(endCooling, ms);
}
function endCooling() {
  for (const m of $$(".move")) {
    m.classList.remove("cool");
    m.removeAttribute("aria-disabled");
  }
  $("#shower-pop").classList.remove("cool");
  if (!sending) paintDock();
}

// ---------- render ----------
function render(s) {
  state = s;
  if (s.serverNow) skew = s.serverNow - Date.now();
  $("#hello").textContent =
    `Hi ${s.name}! Start a pair and send your person the code, or enter theirs.`;

  if (s.mood && MOODS.includes(s.mood) && !moodTimer) myMood = s.mood;

  if (!s.paired && s.code) {
    show("waiting");
    $("#my-code").textContent = s.code;
    return;
  }
  if (!s.paired) return show("pairup");
  // they flipped their mood: you notice
  const pm = MOODS.includes(s.partnerMood) ? s.partnerMood : "happy";
  if (lastPartnerMood && lastPartnerMood !== pm && screen === "home" && !exprTimer.me) {
    setExpr("me", "shock", 900); UI.emote($("#fx"), spriteEl("me"), "shock"); UI.hop(spriteEl("me"), 12);
  }
  lastPartnerMood = pm;

  show("home");
  $("#partner-label").textContent = s.partnerName;
  $("#me-label").textContent = s.name;

  // leave a kiss or an ouch face alone until its timer hands the mood face back
  if (!exprTimer.me) paintSprite("me", myMood, "idle");
  if (!exprTimer.foe) paintSprite("foe", MOODS.includes(s.partnerMood) ? s.partnerMood : "happy", "idle");
  startIdle();

  UI.setBar($("#bar-me"), attention(false));
  UI.setBar($("#bar-foe"), attention(true));

  const needsInstall = isIOS && !isStandalone;
  $("#ios-banner").hidden = !needsInstall;
  $("#push-banner").hidden =
    needsInstall ||
    !pushSupported ||
    (Notification.permission === "granted" && s.hasPush);

  const ul = $("#history");
  ul.innerHTML = "";
  if (!s.recent.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No moves yet. Send something nice.";
    ul.appendChild(li);
  }
  for (const p of s.recent.slice(0, 14)) {
    const li = document.createElement("li");
    li.innerHTML = "<span></span><span></span>";
    li.children[0].textContent = `${p.fromMe ? "You" : s.partnerName} used ${MOVES[p.level]?.name || "Attention"}`;
    li.children[1].textContent = ago(p.at);
    ul.appendChild(li);
  }

  paintDock();
  incoming(s);

  if (firstHome) {
    firstHome = false;
    say(`What will ${s.name} do? Tap your octopus to flip its mood.`, { instant: true });
  }
}

async function refresh() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return show("signin");
  try {
    render(await api("/api/me"));
  } catch (e) {
    if (e.status === 401) {
      await sb.auth.signOut();
      show("signin");
    } else toast(e.message);
  }
}

function startPolling(ms) {
  if (!pollTimer) pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, ms);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ---------- what your partner sent while you were away ----------
// Compared against the newest partner move we have already shown, stored on this device.
// Showers and triple threats get the full treatment; a run of MWAHs is folded into one line.
function incoming(s) {
  if (document.hidden || !s.paired) return;
  const theirs = (s.recent || []).filter((p) => !p.fromMe).sort((a, b) => a.at - b.at);
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch {}
  const newest = theirs.length ? theirs[theirs.length - 1].at : 0;
  const save = () => { try { localStorage.setItem(SEEN_KEY, String(newest)); } catch {} };
  if (seen === null) return save(); // first run on this device: don't replay history
  const fresh = theirs.filter((p) => p.at > Number(seen) && now() - p.at < FRESH_MS);
  save();
  if (!fresh.length) return;

  const who = s.partnerName;
  const lvl = fresh.some((p) => p.level === 5) ? 5 : fresh.some((p) => p.level === 6) ? 6 : fresh[fresh.length - 1].level;
  const kisses = fresh.filter((p) => p.level === 4).length;

  if (lvl === 5) {
    UI.shower({ duration: 7.5, peak: 140 });
    navigator.vibrate?.([120, 60, 120, 60, 200]);
    say(`${who} showered you with love!`);
    UI.burst({ title: "LOVE SHOWER!", sub: `${who} is showering you with affection.`, icons: ["missing", "mwah", "missing"], duration: 2600 });
    return;
  }
  if (lvl === 6) {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
    UI.burst({
      title: "TRIPLE THREAT!",
      sub: `${who} needs attention, misses you and is thinking of you. All at once.`,
      icons: ["attention", "missing", "thinking"], duration: 5200,
    });
    say(`${who} hit you with a TRIPLE THREAT!`);
    theyAttack(6);
    return;
  }
  navigator.vibrate?.(60);
  say(kisses > 1 ? `${who} sent you ${kisses} kisses. MWAH x${kisses}!` : `${who} used ${MOVES[lvl].name.toUpperCase()}!`);
  theyAttack(lvl);
}

// The partner's octopus throws at yours: same animation, roles swapped.
function theyAttack(level) {
  UI.attack({
    me: spriteEl("foe"), foe: spriteEl("me"), layer: $("#fx"), scene: WORLD.root, level,
    onHit: () => exchange("foe", "me", level),
  });
}

// ---------- push ----------
function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!pushSupported) return toast("This browser can't do notifications.");
  const perm = await Notification.requestPermission(); // must come from a tap on iOS
  if (perm !== "granted")
    return toast("Notifications are off. You can change this in Settings.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(config.vapidPublicKey),
    });
  }
  await api("/api/subscribe", sub.toJSON());
  toast("Notifications on");
  refresh();
}

// ---------- events ----------
$("#btn-google").onclick = () =>
  busy($("#btn-google"), async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/" },
    });
    if (error) throw error;
  });

$("#btn-create").onclick = () =>
  busy($("#btn-create"), async () => render(await api("/api/pair", {})));

$("#btn-join").onclick = () =>
  busy($("#btn-join"), async () => {
    const code = $("#code").value.trim().toUpperCase();
    if (code.length !== 6) return toast("Codes are 6 characters");
    render(await api("/api/join", { code }));
  });

$("#btn-havecode").onclick = () => {
  show("pairup");
  $("#code").focus();
};

$("#btn-share").onclick = async () => {
  UI.press($("#btn-share"));
  const text = `Join me on Pay Attention To Me. My code: ${state.code}\n${location.origin}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else {
    await navigator.clipboard?.writeText(text);
    toast("Copied");
  }
};

// One tap sends. The cooldown (5s, or 3s after an MWAH) is the safety net against accidents.
for (const b of $$(".move[data-level]")) b.onclick = () => useMove(Number(b.dataset.level));
$("#shower-pop").onclick = () => useMove(5);

async function useMove(level) {
  if (sending || Date.now() < cooldownUntil || !state?.paired) return;
  sending = true;
  const move = MOVES[level];
  // The third move of the combo lands as a triple threat, so play it as one.
  const combo = level === COMBO[2] && comboProgress() === 2;
  const shown = combo ? 6 : level;

  setCooling(move.cd);
  navigator.vibrate?.(level === 3 || combo ? [80, 40, 80, 40, 120] : level === 5 ? [60, 30, 60, 30, 60] : level === 4 ? 25 : 60);
  if (level === 5) $("#shower-pop").hidden = true;

  const anim =
    level === 5
      ? Promise.resolve(UI.shower({ duration: 4.5, peak: 80 }))
      : UI.attack({
          me: spriteEl("me"), foe: spriteEl("foe"), layer: $("#fx"), scene: WORLD.root, level: shown,
          onHit: () => exchange("me", "foe", shown),
        });
  say(`${state?.name || "You"} used ${(combo ? MOVES[6] : move).name.toUpperCase()}!`, { instant: level === 4 });

  try {
    const r = await api("/api/poke", { level });
    render(r.state);
    if (r.combo) {
      UI.burst({
        title: "TRIPLE THREAT!",
        sub: `Need attention, missing you, thinking of you. ${state.partnerName} got all three.`,
        icons: ["attention", "missing", "thinking"], duration: 4200,
      });
      navigator.vibrate?.([100, 50, 100, 50, 300]);
    }
    await anim;
    const prog = comboProgress();
    const cue = r.combo ? "" : prog === 1 ? " Combo started: missing you next." : prog === 2 ? " One more: thinking of you!" : "";
    const done = r.delivered ? MOVES[r.level || level].hit : "…but they haven't turned on notifications yet.";
    await say(done + cue, { instant: level === 4 });
  } catch (e) {
    await anim;
    // Nothing was sent, so give the buttons back quickly (a 429 means the server is still recharging).
    setCooling(e.status === 429 ? 2000 : 1200);
    if (level === 5) paintDock();
    await say(e.message);
  } finally {
    sending = false;
  }
}

// Mood toy: tap to flip happy → angry → sad. Saved after a short pause so
// cycling through faces doesn't ping your partner three times.
async function flipMyMood() {
  myMood = MOODS[(MOODS.indexOf(myMood) + 1) % MOODS.length];
  navigator.vibrate?.(25);
  await UI.flipMood(spriteEl("me"), () => {
    drawn.me = null;
    paintSprite("me", myMood, "idle");
  });
  clearTimeout(moodTimer);
  moodTimer = setTimeout(async () => {
    moodTimer = null;
    try {
      render(await api("/api/mood", { mood: myMood }));
    } catch (e) {
      toast(e.message);
    }
  }, 1200);
}
$("#sprite-me").onclick = flipMyMood;
$("#btn-flip").onclick = flipMyMood;

$("#btn-push").onclick = () => busy($("#btn-push"), enablePush);

// Music: one toggle per screen, all showing the same state.
const musicBtns = $$(".music-toggle");
function paintMusic() {
  for (const b of musicBtns) {
    b.hidden = !MUSIC.supported;
    b.setAttribute("aria-pressed", String(MUSIC.on));
  }
}
for (const b of musicBtns)
  b.onclick = () => {
    MUSIC.toggle();
    paintMusic();
  };
paintMusic();

// Menu + log
// The menu is reachable from every signed-in screen, so you can always sign out or unpair.
async function openMenu() {
  const { data } = await sb.auth.getSession();
  const email = data.session?.user?.email;
  $("#menu-who").textContent = email ? `Signed in as ${email}` : "";
  $("#menu-name").value = state?.name || "";
  // Unpair when paired, cancel the code while waiting, nothing to leave otherwise.
  const leave = $("#btn-leave");
  leave.hidden = !state?.paired && !state?.code;
  leave.textContent = state?.paired
    ? `Unpair from ${state.partnerName}`
    : "Cancel my code";
  $("#menu").showModal();
  UI.pop($(".menu"), { from: 0.9 });
}
for (const b of $$(".menu-open")) b.onclick = openMenu;
$("#btn-close").onclick = () => $("#menu").close();
// Pull in a new version: drop cached files, update the service worker, then reload.
$("#btn-refresh").onclick = async () => {
  $("#btn-refresh").disabled = true;
  try {
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
  } catch {}
  location.reload();
};
$("#btn-log").onclick = () => { $("#log").showModal(); UI.pop($("#log .menu"), { from: 0.9 }); };
$("#btn-log-close").onclick = () => $("#log").close();
$("#btn-save-name").onclick = () =>
  busy($("#btn-save-name"), async () => {
    render(await api("/api/name", { name: $("#menu-name").value }));
    toast("Saved");
  });
$("#btn-leave").onclick = () =>
  busy($("#btn-leave"), async () => {
    const ask = state?.paired
      ? `Unpair from ${state.partnerName}? You'll need a new code to pair again.`
      : "Cancel your code?";
    if (!confirm(ask)) return;
    await api("/api/leave", {});
    $("#menu").close();
    toast(state?.paired ? "Unpaired" : "Code cancelled");
    await refresh();
  });
$("#btn-signout").onclick = () =>
  busy($("#btn-signout"), async () => {
    await sb.auth.signOut();
    $("#menu").close();
    show("signin");
  });
$("#btn-delete").onclick = () =>
  busy($("#btn-delete"), async () => {
    if (
      !confirm("Delete your account and all your pokes? This can't be undone.")
    )
      return;
    await api("/api/account/delete", {});
    await sb.auth.signOut();
    $("#menu").close();
    show("signin");
  });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && sb) refresh();
});
// A push arrived while the app is open: look right away instead of waiting for the next poll.
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "poke" && sb && !document.hidden) refresh();
});

// ---------- dressing the screens ----------
function decorate() {
  const duel = (a, b) =>
    `<div class="fighter"><div class="pad"></div><div class="lean">${SPRITES.octopus(a, { look: 1 })}</div></div>` +
    `<div class="spark">${SPRITES.heart("pink", 11)}</div>` +
    `<div class="fighter rival"><div class="pad"></div><div class="lean">${SPRITES.octopus(b, { look: -1 })}</div></div>`;
  $("#title-duel").innerHTML = duel("happy", "angry");
  $("#pair-duel").innerHTML = duel("happy", "sad");
  $("#wait-duel").innerHTML = duel("happy", "sad");
  $("#boot-heart").innerHTML = SPRITES.heart("pink", 13);
  $("#shower-icon").innerHTML = SPRITES.heart("pink", 9) + SPRITES.heart("red", 11) + SPRITES.heart("blush", 9);
  $("#streak").innerHTML = "<i></i>".repeat(SHOWER_NEEDS);
  for (const el of $$("[data-icon]")) el.innerHTML = SPRITES.icon(el.dataset.icon);
  for (const b of $$(".music-toggle")) b.innerHTML = SPRITES.uiIcon("music");
  for (const b of $$(".menu-open")) b.innerHTML = SPRITES.uiIcon("menu");
  $("#btn-log").innerHTML = SPRITES.uiIcon("log");
  // wake the fighters up once the world has a layout
  UI.idle($("#title-duel .fighter .lean"), { duration: 1.8, rise: -4 });
  UI.idle($("#title-duel .rival .lean"), { duration: 2.1, rise: -4, delay: 0.3 });
}

// ---------- boot ----------
(async () => {
  decorate();
  ambientGlance();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  try {
    config = await (await fetch("/api/config")).json();
    if (!config.supabaseUrl || !config.supabaseKey)
      throw new Error("Server is missing Supabase config");
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
    // Fires after the Google redirect lands back here, and on sign-out elsewhere
    // (setTimeout: calling Supabase from inside this callback can deadlock its auth lock)
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT")
        setTimeout(refresh, 0);
    });
    await refresh();
  } catch (e) {
    show("signin");
    toast(e.message);
  }
})();
