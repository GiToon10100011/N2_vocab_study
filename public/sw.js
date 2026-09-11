/**
 * 최소 서비스 워커.
 * 불변인 정적 자산만 캐시하고, 페이지와 API 는 항상 네트워크로 보낸다.
 * (학습 데이터는 서버가 단일 출처여야 하므로 응답을 캐시하지 않는다)
 */
const VERSION = "n2v-v1";
const STATIC = /^\/(?:_next\/static\/|icon-|apple-touch-icon|favicon)/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!STATIC.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })(),
  );
});
