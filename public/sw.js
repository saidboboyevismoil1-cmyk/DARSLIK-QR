// EduFocus talaba ilovasi — service worker.
// Faqat talaba ilovasi resurslarini keshlaydi. Ustoz paneli, API va socket.io trafigi tarmoqdan o'tadi.
const VERSION = 'v4.1';
const SHELL = `edufocus-shell-${VERSION}`;
const RUNTIME = `edufocus-runtime-${VERSION}`;

const PRECACHE = [
  '/student.html',
  '/css/student.css?v=4.0',
  '/js/student/app.js?v=4.0',
  '/js/student/util.js',
  '/js/student/state.js',
  '/js/student/net.js',
  '/js/student/lesson.js',
  '/js/student/quiz.js',
  '/js/student/materials.js',
  '/js/student/scanner.js',
  '/js/student/tools.js',
  '/socket.io/socket.io.js',
  '/manifest.json',
  '/img/icon-192.png',
  '/img/icon-512.png',
];

// Faqat ochilganda yuklanadigan og'ir kutubxonalar va dars fayllari — birinchi ishlatilganda keshlanadi
const isLazyAsset = (p) => p === '/js/pdf.min.js' || p === '/js/pdf.worker.min.js' || p === '/js/html5-qrcode.min.js' || p.startsWith('/uploads/');
const isShellAsset = (p) => p === '/student.html' || p === '/manifest.json' || p === '/socket.io/socket.io.js' || p.startsWith('/css/student.css') || p.startsWith('/js/student/') || p.startsWith('/img/');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Bitta fayl yuklanmasa ham o'rnatish to'xtamasin
    await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Keshdan darhol beradi, fonda yangilaydi
async function staleWhileRevalidate(request, cacheName, ignoreSearch) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch });
  const refresh = fetch(request).then((res) => {
    if (res && res.ok) cache.put(ignoreSearch ? new Request(new URL(request.url).pathname) : request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { refresh.catch(() => {}); return cached; }
  return (await refresh) || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  // Range so'rovlari (206) keshlanmaydi
  if (res && res.ok && res.status === 200) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  if (p === '/student.html') {
    event.respondWith(staleWhileRevalidate(req, SHELL, true));
  } else if (isLazyAsset(p)) {
    event.respondWith(cacheFirst(req, RUNTIME));
  } else if (isShellAsset(p)) {
    event.respondWith(staleWhileRevalidate(req, SHELL, false));
  }
  // qolgan hamma narsa (API, socket.io polling, dashboard, login…) — tarmoq orqali
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
