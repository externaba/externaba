// ═══════════════════════════════════════════════════════════════════
// ExternaBA Service Worker
// Strategija: cache-first za statične, network-first za HTML
// Pri svakoj promjeni sadržaja, povećaj CACHE_VERSION da se forsira refresh
// ═══════════════════════════════════════════════════════════════════

const CACHE_VERSION = 'externaba-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Fajlovi koji se kešuju pri instalaciji — sve što app-u treba za offline rad
const PRECACHE_URLS = [
  '/',
  '/externaba.html',
  '/privacy.html',
  '/copyright.html',
  '/manifest.json',
  // KaTeX (matematika)
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',
  // Google Fonts (CSS only — fontovi se kešuju runtime)
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
];

// ─── INSTALL — precache statičnih resursa ──────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install', CACHE_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        // Dodaj resurse jedan po jedan da neuspjeh jednog ne sruši cijelu instalaciju
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting()) // Aktiviraj odmah, ne čekaj reload
  );
});

// ─── ACTIVATE — obriši stare cache-ove ─────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(name => name.startsWith('externaba-') && !name.startsWith(CACHE_VERSION))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim()) // Kontrola nad svim otvorenim tabovima
  );
});

// ─── FETCH — strategija routing ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Samo GET requesti
  if (request.method !== 'GET') return;

  // Ignoriši Chrome extension i ostale non-http(s) sheme
  if (!url.protocol.startsWith('http')) return;

  // Strategija 1: HTML — network-first (uvijek pokušaj svjež, fallback na cache)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Spremi u cache za offline upotrebu
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          // Fallback na cached verziju kad nema mreže
          return caches.match(request)
            .then(cached => cached || caches.match('/externaba.html') || caches.match('/'));
        })
    );
    return;
  }

  // Strategija 2: Statične resurse (CSS, JS, fonts, slike) — cache-first
  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((response) => {
            // Keširaj sve uspješne odgovore osim non-basic CORS
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Ako tražimo sliku i nema je, vrati prazan response da app ne pukne
            if (request.destination === 'image') {
              return new Response('', { status: 200, statusText: 'OK' });
            }
            return new Response('Resurs nije dostupan offline', { status: 503 });
          });
      })
  );
});

// ─── MESSAGE — komunikacija sa stranicom ───────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CACHE_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
