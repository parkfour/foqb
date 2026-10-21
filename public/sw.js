const CACHE_NAME = "accounting-shell-v1";
const APP_SHELL = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

// Only genuinely static, content-hashed assets are safe to cache-first.
// Everything else (page navigations, RSC data fetches, API calls) carries
// live, per-org financial data that changes on every save — caching those
// meant a page could get frozen on whatever was first fetched and only ever
// catch up one visit behind, never showing what's actually current. The
// app's real offline story is the journal-entry queue in IndexedDB
// (lib/db/offline.ts), not an HTTP cache of dynamic pages.
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));

      // Self-heal installs that already have dynamic pages cached from
      // before this fix — purge anything that isn't a static asset.
      const cache = await caches.open(CACHE_NAME);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((request) => !isCacheableAsset(new URL(request.url)))
          .map((request) => cache.delete(request)),
      );
    })(),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || network;
      }),
    );
    return;
  }

  // Live data: always go to the network. Fall back to the cached app shell
  // only if the network is genuinely unreachable, so the client JS can
  // still boot and the offline journal-entry queue can take over.
  event.respondWith(fetch(event.request).catch(() => caches.match("/")));
});
