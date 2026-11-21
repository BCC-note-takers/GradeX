/* Service worker: caches the app shell; notes are cached as they are read (network first, cache fallback). */
const VERSION = "notes-v2";
const SHELL = ["./", "index.html", "app.js", "manifest.json", "icon-32.png", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isNote = url.hostname === "raw.githubusercontent.com";
  const isShell = url.origin === location.origin;
  if (!isNote && !isShell) return;               // other origins go straight to the network

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => {
        if (hit) return hit;
        // Only page loads fall back to the app shell. A note that was never cached must fail
        // cleanly instead of being answered with index.html (which would show up as a "note").
        if (req.mode === "navigate") return caches.match("index.html");
        return new Response("offline", { status: 503, statusText: "Offline" });
      }))
  );
});
