/*
 * CivicProof service worker.
 *
 * - Pages: network first; the last good copy is shown when offline, else /offline.
 * - Build assets (/_next/static, hashed and immutable), icons and fonts: cache first.
 * - API calls, media, PDFs and documents are never cached: cases change, and a reporter's
 *   private documents must not linger in a shared device's cache.
 */
const VERSION = "civicproof-v2";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const OFFLINE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/documents/") || url.pathname.endsWith(".pdf")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/maplibre/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            // Clone before handing the response back: once the page reads the body it can't be copied.
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        // Next varies pages on router headers that a plain navigation doesn't send.
        .catch(() => caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match(OFFLINE, { ignoreVary: true }))),
    );
  }
});
