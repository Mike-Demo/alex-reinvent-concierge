/* Alex Rivers concierge service worker.
 *
 * Goal: keep the app fast and usable on congested venue WiFi.
 * - Navigations are network-first (a fresh deploy always wins) with a
 *   cached fallback, so a dead network still opens the app.
 * - The app shell is precached; static files and the pinned CDN kits
 *   are cache-first, so repeat visits skip the network almost entirely.
 * - Feed/buzz/geo GETs are stale-while-revalidate: instant render from
 *   cache, refreshed in the background when the network cooperates.
 * - Credential and private endpoints are never cached.
 * - Map tiles the visitor has already viewed are kept (capped), so
 *   panning back over the campus works offline.
 *
 * IMPORTANT: bump VERSION on every publish, or returning visitors keep
 * the previous build's cache-first assets. */
const VERSION = "pc-20261126-3";
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const TILES = `${VERSION}-tiles`;
const TILE_CAP = 300;

const PRECACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/app.css",
  "/omniagent-ui.css",
  "/events.json",
  "/manifest.webmanifest",
  "/icon.jpg",
  "/licenses.html",
];

const CDN_HOSTS = new Set([
  "ka-p.webawesome.com",
  "kit.fontawesome.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);
const NEVER_CACHE = ["/api/token", "/api/intros", "/api/notes", "/api/session-webhook"];
const SWR_API = ["/api/feed", "/api/buzz", "/api/geo"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (NEVER_CACHE.some((p) => url.pathname.startsWith(p))) return; // network only

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return (await caches.match("/index.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.origin === self.location.origin && SWR_API.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME));
    return;
  }

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(
      (async () => {
        const res = await cacheFirst(req, TILES);
        const cache = await caches.open(TILES);
        const keys = await cache.keys();
        if (keys.length > TILE_CAP) {
          await Promise.all(
            keys.slice(0, keys.length - TILE_CAP).map((k) => cache.delete(k)),
          );
        }
        return res;
      })(),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (req.headers.has("range")) return; // media range requests go to the network
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }

  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME));
    return;
  }
});
