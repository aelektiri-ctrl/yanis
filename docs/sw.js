// Yanis : l'appli s'ouvre meme sans reseau ; les donnees sont toujours rechargees en priorite.
const CACHE = "yanis-v16";
const COQUILLE = ["./", "index.html", "manifest.json", "icone-192.png", "icone-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return; // scores en direct : directement au reseau
  e.respondWith(fetch(e.request).then(r => {
    const copie = r.clone();
    caches.open(CACHE).then(c => c.put(e.request.url.split("?")[0], copie));
    return r;
  }).catch(() => caches.match(e.request.url.split("?")[0])));
});
