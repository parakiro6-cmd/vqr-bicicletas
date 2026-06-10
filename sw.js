// =============================================
// SERVICE WORKER - VQR Control de Bicicletas
// Versión: 1.0.0
// =============================================

const CACHE_NAME = 'vqr-cache-v4';
const URLS_TO_CACHE = [
  './index.html',
  './app.js',
  './manifest.json',
  './logo.png'
];

// ── Instalación: precachear archivos estáticos ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Archivos en caché');
      return cache.addAll(URLS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// ── Activación: limpiar cachés antiguas ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache First para assets, Network First para API ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Peticiones a Supabase: Network First
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(JSON.stringify({ error: 'Sin conexión' }), {
          headers: { 'Content-Type': 'application/json' }
        }))
    );
    return;
  }

  // Archivos estáticos: Cache First
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
    )
  );
});
