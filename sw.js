// Offline: app shell cache-first; decks network-first with cache fallback.
const VERSION = "v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open("shell-" + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== "shell-" + VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/decks/")) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open("decks").then(c => c.put(e.request.url.split("?")[0], copy)); return r; })
      .catch(() => caches.match(e.request.url.split("?")[0])));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    const copy = r.clone(); caches.open("shell-" + VERSION).then(c => c.put(e.request, copy)); return r;
  })));
});
