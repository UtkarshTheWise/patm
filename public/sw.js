// Service worker: shows push notifications and caches the app shell.
const CACHE = "patm-v4";
const SHELL = [
  "/", "/index.html", "/style.css", "/app.js", "/sprites.js", "/ui.js", "/music.js",
  "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png",
  "/vendor/supabase.js", "/vendor/gsap.js",
];

self.addEventListener("install", (e) => {
  // One file at a time, failures ignored: addAll() rejects the whole install if
  // any entry 404s or redirects (e.g. /vendor/gsap.js falling back to the CDN).
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(SHELL.map((url) => c.add(new Request(url, { redirect: "follow" })).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network first for everything; fall back to cache for the shell when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Audio is left to the browser: it streams with Range requests, which a cached copy can't answer.
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/audio/")) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match("/"))));
});

self.addEventListener("push", (e) => {
  let data = { title: "pay attention to me", body: "Someone wants you." };
  try { data = { ...data, ...e.data.json() }; } catch {}
  const vibrate = data.level === 3 ? [200, 100, 200, 100, 400] : [120];
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "patm",       // collapse repeated pokes into one notification
      renotify: true,    // but still buzz each time
      vibrate,
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => "focus" in c);
      return w ? w.focus() : self.clients.openWindow("/");
    })
  );
});
