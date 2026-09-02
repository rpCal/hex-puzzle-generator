/*
 * Offline cache.
 *
 * Stale-while-revalidate over same-origin GETs: serve from cache immediately when there is a hit,
 * and refresh the entry in the background. The game becomes playable offline after one visit and
 * picks up a new build on the visit after it ships, with no build-time asset manifest to keep in
 * step with content hashes.
 *
 * Written as plain JS in `public/` rather than TypeScript so it ships byte-for-byte as authored --
 * a service worker is fetched by URL, not bundled, and its scope is its own directory.
 */

const CACHE = 'hexforge-v1';

self.addEventListener('install', (event) => {
  // Take over as soon as the new worker is ready rather than waiting for every tab to close.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          // Only cache real, complete responses. An opaque or error response cached here would
          // be served back forever.
          if (response.ok && response.type === 'basic') {
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        })
        .catch(() => null);

      if (cached !== undefined) {
        // Refresh in the background; the caller gets the cached copy now.
        event.waitUntil(network);
        return cached;
      }

      const response = await network;
      if (response !== null) return response;

      // Offline and never seen: fall back to the app shell so a deep link still opens the game.
      const shell = await cache.match(`${self.registration.scope}index.html`);
      if (shell !== undefined) return shell;
      return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
    })(),
  );
});
