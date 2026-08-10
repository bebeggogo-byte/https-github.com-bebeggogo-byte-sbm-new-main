/* 강의 스튜디오 서비스워커 — 오프라인 셸 캐시
   앱 파일만 캐시한다. 녹음/자막/아톰 데이터는 IndexedDB(브라우저)에 저장되며 캐시하지 않는다. */
const CACHE = 'lecture-studio-v13';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './studio.css',
  './manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 앱 스코프(및 아이콘/파비콘)만 처리. 외부 API 호출(클로드 등)은 건드리지 않는다.
  const inScope = url.origin === location.origin &&
    (url.pathname.startsWith('/studio/') || /\/(icons\/|favicon\.svg$)/.test(url.pathname));
  if (!inScope) return;

  if (req.mode === 'navigate') {
    // 네트워크 우선, 실패 시 캐시된 셸
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }
  // 정적 자산: 캐시 우선
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
