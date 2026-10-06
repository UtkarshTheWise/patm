// Pay Attention To Me — client
// Sign-in: Google via Supabase Auth. Every API call sends the Supabase access token,
// which the server verifies before touching the database.
// All motion goes through UI (ui.js); all art comes from SPRITES (sprites.js).
const $ = (s) => document.querySelector(s);

let sb = null;          // Supabase client (auth only — no direct table access from the browser)
let config = null;      // { supabaseUrl, supabaseKey, vapidPublicKey }
let state = null;       // last /api/me response
let level = 1;
let pollTimer = null;

// The three attention moves, dressed as battle moves.
const MOVES = {
  1: { name: "Need Attention",  type: "NEEDY",   pp: "15/15", hit: "It landed softly." },
  2: { name: "Thinking of You", type: "SWEET",   pp: "20/20", hit: "It was sweet!" },
  3: { name: "Missing You",     type: "LONGING", pp: "10/10", hit: "It's super effective!" },
};

const MOODS = ["happy", "angry", "sad"];
const POKE_COOLDOWN_MS = 10_000;   // matches the server
const ATTENTION_DECAY_MS = 6 * 60 * 60 * 1000;

let myMood = "happy";
let cooldownUntil = 0;
let cdTimer = null;
let moodTimer = null;
let drawnMood = { me: null, foe: null };
let idling = false;
let firstHome = true;

// ---------- helpers ----------
async function api(path, body) {
  const { data } = await sb.auth.getSession(); // refreshes the token if it expired
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || "Something went wrong"), { status: res.status });
  return json;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}

function show(id) {
  UI.showScreen(id);
  if (id !== "waiting") stopPolling();
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function busy(btn, fn) {
  UI.press(btn);
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// ---------- battle scene ----------
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
  const left = 1 - (Date.now() - last.at) / ATTENTION_DECAY_MS;
  return Math.max(6, Math.min(100, Math.round(left * 100)));
}

function paintSprite(which, mood) {
  if (drawnMood[which] === mood) return;
  drawnMood[which] = mood;
  const el = which === "me" ? $("#sprite-me") : $("#sprite-foe");
  el.innerHTML = SPRITES.octopus(mood, { flip: which === "me" });
  const label = SPRITES.MOOD[mood].label;
  if (which === "me") {
    $("#me-mood-label").textContent = label;
    el.setAttribute("aria-label", `Your mood: ${label.toLowerCase()}. Tap to flip it.`);
  } else {
    $("#foe-mood-label").textContent = label;
  }
}

function startIdle() {
  if (idling) return;
  idling = true;
  UI.idle($("#sprite-me"), { duration: 1.6 });
  UI.idle($("#sprite-foe"), { duration: 2.0, delay: 0.4, rise: -5 });
}

function selectMove(btn, opts) {
  level = Number(btn.dataset.level);
  for (const m of document.querySelectorAll(".move[data-level]")) {
    m.setAttribute("aria-checked", String(m === btn));
  }
  $("#move-type").textContent = `TYPE/ ${MOVES[level].type}`;
  if (Date.now() >= cooldownUntil) $("#move-pp").textContent = `PP ${MOVES[level].pp}`;
  UI.cursorTo($("#cursor"), btn);
  // Say so out loud — otherwise the first tap of a two-tap send looks like nothing happened.
  if (!(opts && opts.quiet) && Date.now() >= cooldownUntil) {
    say(`${MOVES[level].name.toUpperCase()} — tap again to send.`);
  }
}

function setMovesEnabled(on) {
  for (const m of document.querySelectorAll(".move[data-level]")) m.disabled = !on;
}

function tickCooldown() {
  clearTimeout(cdTimer);
  const left = cooldownUntil - Date.now();
  if (left <= 0) {
    setMovesEnabled(true);
    $("#move-pp").textContent = `PP ${MOVES[level].pp}`;
    idlePrompt();
    return;
  }
  $("#move-pp").textContent = `READY IN ${Math.ceil(left / 1000)}S`;
  cdTimer = setTimeout(tickCooldown, 250);
}

function startCooldown(ms) {
  cooldownUntil = Date.now() + ms;
  setMovesEnabled(false);
  tickCooldown();
}

// ---------- render ----------
function render(s) {
  state = s;
  $("#hello").textContent = `Hi ${s.name}! Start a pair and send your person the code, or enter theirs.`;

  if (s.mood && MOODS.includes(s.mood) && !moodTimer) myMood = s.mood;

  if (!s.paired && s.code) {
    show("waiting");
    $("#my-code").textContent = s.code;
    startPolling();
    return;
  }
  if (!s.paired) return show("pairup");

  show("home");
  $("#partner-label").textContent = s.partnerName;
  $("#me-label").textContent = s.name;

  paintSprite("me", myMood);
  paintSprite("foe", MOODS.includes(s.partnerMood) ? s.partnerMood : "happy");
  startIdle();

  UI.setBar($("#bar-me"), attention(false));
  UI.setBar($("#bar-foe"), attention(true));
  // The scene was hidden when the move was first selected, so the cursor had
  // nothing to measure. Re-seat it now that there is layout.
  UI.cursorTo($("#cursor"), document.querySelector('.move[aria-checked="true"]'));

  const needsInstall = isIOS && !isStandalone;
  $("#ios-banner").hidden = !needsInstall;
  $("#push-banner").hidden =
    needsInstall || !pushSupported || (Notification.permission === "granted" && s.hasPush);

  const ul = $("#history");
  ul.innerHTML = "";
  for (const p of s.recent) {
    const li = document.createElement("li");
    li.innerHTML = "<span></span><span></span>";
    li.children[0].textContent = `${p.fromMe ? "You" : s.partnerName} used ${MOVES[p.level]?.name || "Attention"}`;
    li.children[1].textContent = ago(p.at);
    ul.appendChild(li);
  }

  if (firstHome) { firstHome = false; idlePrompt(); }
}

async function refresh() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return show("signin");
  try {
    render(await api("/api/me"));
  } catch (e) {
    if (e.status === 401) { await sb.auth.signOut(); show("signin"); }
    else toast(e.message);
  }
}

function startPolling() { if (!pollTimer) pollTimer = setInterval(refresh, 3000); }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

// ---------- push ----------
function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!pushSupported) return toast("This browser can't do notifications.");
  const perm = await Notification.requestPermission(); // must come from a tap on iOS
  if (perm !== "granted") return toast("Notifications are off. You can change this in Settings.");
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
$("#btn-google").onclick = () => busy($("#btn-google"), async () => {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + "/" },
  });
  if (error) throw error;
});

$("#btn-create").onclick = () => busy($("#btn-create"), async () => render(await api("/api/pair", {})));

$("#btn-join").onclick = () => busy($("#btn-join"), async () => {
  const code = $("#code").value.trim().toUpperCase();
  if (code.length !== 6) return toast("Codes are 6 characters");
  render(await api("/api/join", { code }));
});

$("#btn-havecode").onclick = () => { show("pairup"); $("#code").focus(); };

$("#btn-share").onclick = async () => {
  UI.press($("#btn-share"));
  const text = `Join me on Pay Attention To Me. My code: ${state.code}\n${location.origin}`;
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else { await navigator.clipboard?.writeText(text); toast("Copied"); }
};

for (const b of document.querySelectorAll(".move[data-level]")) {
  b.addEventListener("pointerenter", () => { if (!b.disabled) UI.cursorTo($("#cursor"), b); });
  b.onclick = () => useMove(b);
}

// Tapping a move selects it first; tapping the selected one fires it.
// One tap does both when it is already selected, so it never feels sticky.
async function useMove(btn) {
  const lvl = Number(btn.dataset.level);
  if (lvl !== level) { selectMove(btn); return; }
  if (Date.now() < cooldownUntil) return;

  const move = MOVES[level];
  setMovesEnabled(false);
  navigator.vibrate?.(level === 3 ? [80, 40, 80, 40, 120] : 60);

  const anim = UI.attack({
    me: $("#sprite-me"), foe: $("#sprite-foe"),
    layer: $("#fx"), scene: $("#scene"), level,
  });
  say(`${state?.name || "You"} used ${move.name.toUpperCase()}!`);

  try {
    const r = await api("/api/poke", { level });
    await anim;
    render(r.state);
    await say(r.delivered ? move.hit : "…but they haven't turned on notifications yet.");
    startCooldown(POKE_COOLDOWN_MS);
  } catch (e) {
    await anim;
    await say(e.message);
    startCooldown(e.status === 429 ? 4000 : 1200);
  }
}

// Mood toy: tap to flip happy → angry → sad. Saved after a short pause so
// cycling through faces doesn't ping your partner three times.
$("#sprite-me").onclick = async () => {
  myMood = MOODS[(MOODS.indexOf(myMood) + 1) % MOODS.length];
  $("#mood-hint").hidden = true;
  navigator.vibrate?.(25);
  await UI.flipMood($("#sprite-me"), () => {
    drawnMood.me = null;
    paintSprite("me", myMood);
  });
  clearTimeout(moodTimer);
  moodTimer = setTimeout(async () => {
    moodTimer = null;
    try { render(await api("/api/mood", { mood: myMood })); }
    catch (e) { toast(e.message); }
  }, 1200);
};

$("#btn-push").onclick = () => busy($("#btn-push"), enablePush);

// Menu
$("#btn-menu").onclick = async () => {
  const { data } = await sb.auth.getSession();
  const email = data.session?.user?.email;
  $("#menu-who").textContent = email ? `Signed in as ${email}` : "";
  $("#menu-name").value = state?.name || "";
  $("#menu").showModal();
  UI.pop($(".menu"), { from: 0.88 });
};
$("#btn-close").onclick = () => $("#menu").close();
$("#btn-save-name").onclick = () => busy($("#btn-save-name"), async () => {
  render(await api("/api/name", { name: $("#menu-name").value }));
  toast("Saved");
});
$("#btn-leave").onclick = () => busy($("#btn-leave"), async () => {
  if (!confirm(`Unpair from ${state?.partnerName || "your partner"}?`)) return;
  await api("/api/leave", {});
  $("#menu").close();
  refresh();
});
$("#btn-signout").onclick = async () => {
  await sb.auth.signOut();
  $("#menu").close();
  show("signin");
};
$("#btn-delete").onclick = () => busy($("#btn-delete"), async () => {
  if (!confirm("Delete your account and all your pokes? This can't be undone.")) return;
  await api("/api/account/delete", {});
  await sb.auth.signOut();
  $("#menu").close();
  show("signin");
});

document.addEventListener("visibilitychange", () => { if (!document.hidden && sb) refresh(); });
window.addEventListener("resize", () => {
  const sel = document.querySelector('.move[aria-checked="true"]');
  if (sel && !$("#home").hidden) UI.cursorTo($("#cursor"), sel);
});

// ---------- scenery ----------
function dressTheSky() {
  const clouds = $("#sky-clouds");
  const spots = [
    { left: "2%",  top: "6%",  w: 120, d: 0 },
    { left: "66%", top: "3%",  w: 150, d: 2 },
    { left: "8%",  top: "34%", w: 90,  d: 4 },
  ];
  for (const s of spots) {
    const el = document.createElement("div");
    el.innerHTML = SPRITES.cloud();
    el.style.left = s.left;
    el.style.top = s.top;
    el.style.width = s.w + "px";
    clouds.appendChild(el);
    UI.float(el, { drift: 26, duration: 11 + s.d, delay: s.d });
  }
  UI.ambient($("#sky-hearts"), 7);
  $("#boot-heart").innerHTML = SPRITES.heart("#ff5e86");
  $("#title-octo").innerHTML = SPRITES.octopus("happy");
  UI.idle($("#title-octo"), { duration: 1.8 });
}

// ---------- boot ----------
(async () => {
  dressTheSky();
  selectMove(document.querySelector('.move[data-level="1"]'), { quiet: true });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  try {
    config = await (await fetch("/api/config")).json();
    if (!config.supabaseUrl || !config.supabaseKey) throw new Error("Server is missing Supabase config");
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true },
    });
    // Fires after the Google redirect lands back here, and on sign-out elsewhere
    // (setTimeout: calling Supabase from inside this callback can deadlock its auth lock)
    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(refresh, 0);
    });
    await refresh();
  } catch (e) {
    show("signin");
    toast(e.message);
  }
})();
