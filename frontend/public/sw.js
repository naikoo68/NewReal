/* Simple, dependency-free service worker for the installable PWA.
   - Precaches the app shell (index.html) so the app opens offline.
   - Same-origin static assets: stale-while-revalidate.
   - Navigations: network-first, fall back to the cached shell when offline.
   - Cross-origin requests (the API on Render, any CDN) are NEVER intercepted,
     so live data always comes fresh from the network.
   Bump CACHE when you want every client to drop old cached assets. */
const CACHE = "msg-pwa-v3";
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle our own origin — never touch the API or third-party CDNs.
  if (url.origin !== self.location.origin) return;

  // App navigations (page loads/refreshes): try the network, fall back to the
  // cached shell so the app still opens offline (HashRouter handles the route).
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(SHELL)));
    return;
  }

  // Static assets (JS/CSS/images/fonts): serve cached instantly, refresh in bg.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
