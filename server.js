// Pay Attention To Me — backend
// - Google sign-in via Supabase Auth (the browser gets a session; we verify its token here)
// - Data in Supabase Postgres (see supabase/schema.sql)
// - "Poke" sends a Web Push to your partner

require("dotenv").config();
const express = require("express");
const webpush = require("web-push");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const PORT = process.env.PORT || 3000;

// Cooldown that follows each move, keyed by the level just sent. MWAH is short so it can be spammed.
const COOLDOWN_MS = { 1: 5000, 2: 5000, 3: 5000, 4: 3000, 5: 5000, 6: 5000, 7: 5000, 8: 5000, 9: 5000 };
const COOLDOWN_SLACK_MS = 400; // forgive network jitter so the client's own timer never gets a 429
// Combos: three moves back to back (1 attention, 2 thinking, 3 missing, 4 MWAH). The last one lands as
// the combo's own level. Keep in sync with public/app.js.
const COMBOS = {
  6: [1, 3, 2], // Triple threat
  7: [2, 3, 4], // Love letter
  8: [4, 1, 3], // Heartbreaker
  9: [3, 2, 4], // Sweet dreams
};
const COMBO_WINDOW_MS = 60_000;
// Love shower unlocks after a burst of MWAH.
const SHOWER_NEEDS = 7; // the client asks for 8; one spare for a dropped tap
const SHOWER_WINDOW_MS = 60_000;

// ---------- VAPID keys ----------
// Production: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Local dev: generated once into data/vapid.json.
let vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
if (!vapid.publicKey || !vapid.privateKey) {
  const file = path.join(__dirname, "data", "vapid.json");
  if (fs.existsSync(file)) vapid = JSON.parse(fs.readFileSync(file, "utf8"));
  else {
    vapid = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(vapid, null, 2));
    console.warn("No VAPID env vars — generated dev keys in data/vapid.json. Set env vars in production.");
  }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@example.com", vapid.publicKey, vapid.privateKey);

// Levels 1-4 are the buttons in the battle UI; 5 (love shower) is unlocked by spamming MWAH;
// 6-9 (the combos) are what the third move of a combo turns into.
const LEVELS = {
  1: { title: "NEED ATTENTION!", body: "{name} needs a little attention." },
  2: { title: "Thinking of you", body: "{name} is thinking about you right now." },
  3: { title: "Missing you", body: "{name} misses you. It was super effective." },
  4: { title: "MWAH 💋", body: "{name} blew you a kiss." },
  5: { title: "💞 LOVE SHOWER INCOMING 💞", body: "{name} is showering you with affection. Open the app right now!" },
  6: { title: "💥 TRIPLE THREAT! 💥", body: "{name} needs attention, misses you AND is thinking of you. Do not leave them on read." },
  7: { title: "💌 LOVE LETTER! 💌", body: "{name} is thinking of you, misses you and sent a kiss. Swoon." },
  8: { title: "💔 HEARTBREAKER! 💔", body: "{name} blew a kiss, needs attention and misses you. Reply right now." },
  9: { title: "🌙 SWEET DREAMS! 🌙", body: "{name} misses you, is thinking of you and sent a goodnight kiss." },
};

// Pushed when the octopus toy gets flipped.
const MOOD_PUSH = {
  happy: { title: "Mood: happy", body: "{name} flipped the octopus to its pink side." },
  angry: { title: "Mood: angry", body: "{name} flipped the octopus. Tread carefully." },
  sad:   { title: "Mood: sad",   body: "{name} flipped the octopus to sad. Go be nice." },
};

// ---------- app ----------
const app = express();
// Liveness probe for the host (Render's healthCheckPath). Deliberately doesn't touch Supabase.
app.get("/healthz", (_req, res) => res.type("text").send("ok"));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/vendor/supabase.js", (_req, res) =>
  res.sendFile(require.resolve("@supabase/supabase-js/dist/umd/supabase.js")));

// GSAP drives every animation in the client. Served from node_modules so the
// app still animates offline; the CDN is only a fallback for a missing install.
app.get("/vendor/gsap.js", (_req, res) => {
  try { res.sendFile(require.resolve("gsap/dist/gsap.min.js")); }
  catch { res.redirect(302, "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"); }
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Verifies "Authorization: Bearer <supabase access token>" and loads the profile.
const auth = wrap(async (req, res, next) => {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const user = await db.userFromToken(token);
  if (!user) return res.status(401).json({ error: "Please sign in again" });
  req.user = user;
  req.profile = await db.ensureProfile(user);
  next();
});

async function stateFor(profile) {
  const [partner, pair, recent, hasPush] = await Promise.all([
    db.getPartner(profile),
    db.getPair(profile.pair_id),
    db.recentPokes(profile.pair_id, 30),
    db.hasSubscription(profile.id),
  ]);
  return {
    name: profile.name,
    avatarUrl: profile.avatar_url,
    mood: profile.mood || "happy",
    partnerMood: partner?.mood || "happy",
    code: pair?.code || null,
    paired: !!partner,
    partnerName: partner?.name || null,
    hasPush,
    recent: recent.map((p) => ({ fromMe: p.from_user === profile.id, level: p.level, at: Date.parse(p.created_at) })),
    serverNow: Date.now(),
  };
}

// Public config for the browser. The publishable key is safe to expose; RLS blocks it from all tables.
app.get("/api/config", (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    vapidPublicKey: vapid.publicKey,
  });
});

app.get("/api/me", auth, wrap(async (req, res) => res.json(await stateFor(req.profile))));

app.post("/api/name", auth, wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: "Name can't be empty" });
  await db.updateName(req.profile.id, name);
  res.json(await stateFor({ ...req.profile, name }));
}));

// Start a pair → get a code to share
// Flip the octopus mood toy. Pushed to your partner only when it actually
// changed, so cycling happy -> angry -> sad -> happy stays silent.
app.post("/api/mood", auth, wrap(async (req, res) => {
  const mood = String(req.body?.mood || "");
  if (!db.MOODS.includes(mood)) return res.status(400).json({ error: "Unknown mood" });

  const changed = mood !== (req.profile.mood || "happy");
  if (!(await db.updateMood(req.profile.id, mood))) {
    return res.status(503).json({ error: "Moods need the latest supabase/schema.sql — re-run it." });
  }
  const me = { ...req.profile, mood };
  if (changed) {
    const partner = await db.getPartner(me);
    const tpl = MOOD_PUSH[mood];
    if (partner) sendPush(partner.id, { title: tpl.title, body: tpl.body.replace("{name}", me.name) });
  }
  res.json(await stateFor(me));
}));

app.post("/api/pair", auth, wrap(async (req, res) => {
  await db.createPair(req.profile);
  res.json(await stateFor(await db.getProfile(req.profile.id)));
}));

// Join your partner using their code
app.post("/api/join", auth, wrap(async (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) return res.status(400).json({ error: "Codes are 6 letters/numbers" });
  await db.joinPair(req.profile.id, code);
  const me = await db.getProfile(req.profile.id);
  const partner = await db.getPartner(me);
  if (partner) sendPush(partner.id, { title: "You're connected 💞", body: `${me.name} joined you.` });
  res.json(await stateFor(me));
}));

app.post("/api/leave", auth, wrap(async (req, res) => {
  await db.leavePair(req.profile.id);
  res.json({ ok: true });
}));

app.post("/api/account/delete", auth, wrap(async (req, res) => {
  await db.deleteAccount(req.profile.id);
  res.json({ ok: true });
}));

app.post("/api/subscribe", auth, wrap(async (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Bad push subscription" });
  }
  await db.saveSubscription(req.profile.id, sub);
  res.json({ ok: true });
}));

app.post("/api/poke", auth, wrap(async (req, res) => {
  const me = req.profile;
  const partner = await db.getPartner(me);
  if (!partner) return res.status(400).json({ error: "Not paired yet" });

  let level = [1, 2, 3, 4, 5].includes(req.body?.level) ? req.body.level : 1;
  const now = Date.now();
  const mine = (await db.recentPokes(me.pair_id, 30)).filter((p) => p.from_user === me.id); // newest first
  const age = (p) => now - Date.parse(p.created_at);

  if (level === 5) {
    const kisses = mine.filter((p) => p.level === 4 && age(p) <= SHOWER_WINDOW_MS).length;
    if (kisses < SHOWER_NEEDS) return res.status(400).json({ error: "Send more MWAH to unlock the shower." });
  }
  // The cooldown you owe is the one belonging to the move you sent last.
  const owed = Math.max(0, (COOLDOWN_MS[mine[0]?.level] ?? 5000) - COOLDOWN_SLACK_MS);
  if (!(await db.claimPokeSlot(me, owed))) {
    return res.status(429).json({ error: "Easy there. Still recharging." });
  }
  // Third move of the combo: upgrade it so the partner gets one loud notification, not a quiet one.
  const [prev, prev2] = mine;
  const comboId = Object.keys(COMBOS).map(Number).find((id) => {
    const [a, b, c] = COMBOS[id];
    return level === c && prev?.level === b && prev2?.level === a && age(prev2) <= COMBO_WINDOW_MS;
  });
  const combo = comboId !== undefined;
  if (combo) level = comboId;

  await db.addPoke(me.pair_id, me.id, level);
  const tpl = LEVELS[level];
  const delivered = await sendPush(partner.id, {
    title: tpl.title,
    body: tpl.body.replace("{name}", me.name),
    level,
  });
  res.json({ ok: true, delivered, level, combo, state: await stateFor(me) });
}));

async function sendPush(userId, payload) {
  const subs = await db.getSubscriptions(userId);
  let delivered = 0;
  await Promise.all(subs.map(async ({ endpoint, subscription }) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      delivered++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await db.deleteSubscription(endpoint); // dead sub
      else console.error("push failed:", err.statusCode || err.code || "", err.body || err.message);
    }
  }));
  return delivered;
}

// Errors → JSON
app.use((err, _req, res, _next) => {
  if (err instanceof db.AppError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Pay Attention To Me running on http://localhost:${PORT}`));
}
module.exports = app;
