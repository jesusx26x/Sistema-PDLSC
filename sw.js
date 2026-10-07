/**
 * =========================================================================
 * THOR ESSENCE — SERVICE WORKER (PWA OFFLINE COMPLETO)
 * =========================================================================
 * Provee funcionamiento 100% offline para Pamela:
 * - Pre-cache de archivos estáticos (HTML, JS, CSS, assets)
 * - Cache de bibliotecas CDN (Tailwind, Chart.js, Fonts)
 * - Network-First con fallback a caché para APIs dinámicas
 */

const CACHE_NAME = 'thor-essence-cache-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/api.js',
  './js/app.js',
  './manifest.json',
  './assets/logo.jpg'
];

// Instalación: pre-cachear archivos críticos del sistema
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[ServiceWorker] Pre-cacheando archivos estáticos de Thor Essence');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[ServiceWorker] Advertencia pre-cacheando algunos assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activación: limpiar caches obsoletos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Eliminando caché anterior:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercepción de solicitudes
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Las solicitudes a Google Apps Script (API) NUNCA se sirven desde caché del service worker;
  // api.js maneja su propio caché en localStorage y outbox queue.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  // 2. Recursos de red (HTML, JS, CSS, CDN, fuentes, imágenes)
  // Estrategia: Stale-While-Revalidate (Entrega rápida desde caché + actualización en segundo plano)
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cachedResponse = await cache.match(event.request);

      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(err => {
        // En caso de fallo de red, si tenemos caché lo usamos; si no, devolvemos index.html para navegación
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') {
          return cache.match('./index.html') || cache.match('./');
        }
        throw err;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
