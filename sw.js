/**
 * =========================================================================
 * THOR ESSENCE — SERVICE WORKER (PWA OFFLINE COMPLETO)
 * =========================================================================
 * - Todo lo necesario para abrir la app (HTML, JS, CSS compilado, Chart.js, logo)
 *   se pre-cachea al instalar: la app abre y se ve bien sin conexión.
 * - Archivos del sitio: primero la red (siempre la versión más reciente tras un
 *   despliegue) y, si no hay conexión o tarda demasiado, la copia guardada.
 * - Fuentes de Google: primero la caché (no cambian).
 * - La API de Google Apps Script nunca pasa por aquí: api.js maneja su propia
 *   caché y cola offline.
 *
 * IMPORTANTE: subir CACHE_NAME en cada despliegue del frontend.
 */

const CACHE_NAME = 'thor-essence-cache-v7';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './css/tailwind.css',
  './js/config.js',
  './js/api.js',
  './js/app.js',
  './js/vendor/chart.umd.min.js',
  './manifest.json',
  './assets/logo.jpg'
];
const HOSTS_FUENTES = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const TIMEOUT_RED_MS = 4000;

// Instalación: pre-cachear el app shell (cada archivo por separado: si uno falla, el resto queda)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(
      APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(err => {
        console.warn('[ServiceWorker] No se pudo pre-cachear', url, err);
      }))
    ))
  );
  self.skipWaiting();
});

// Activación: limpiar caches de versiones anteriores
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

function guardarEnCache(request, response) {
  // Las fuentes llegan como respuestas "opacas" (status 0): también se guardan
  if (response && (response.ok || response.type === 'opaque')) {
    const copia = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copia));
  }
  return response;
}

async function primeroRed(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const red = fetch(request).then(response => guardarEnCache(request, response));

  // Si la red tarda (señal débil), responder con la copia guardada y actualizar en segundo plano
  const tiempoAgotado = new Promise(resolve => setTimeout(resolve, TIMEOUT_RED_MS, null));
  try {
    const respuesta = await Promise.race([red, tiempoAgotado]);
    if (respuesta) return respuesta;
  } catch (e) {
    // sin conexión: usar la caché
  }

  const enCache = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (enCache) {
    event.waitUntil(red.catch(() => {}));
    return enCache;
  }
  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  return red; // sin copia: esperar a la red (o fallar)
}

async function primeroCache(request) {
  const enCache = await caches.match(request);
  if (enCache) return enCache;
  const response = await fetch(request);
  return guardarEnCache(request, response);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API de Google Apps Script: siempre a la red (api.js gestiona caché y cola offline)
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  if (HOSTS_FUENTES.includes(url.hostname)) {
    event.respondWith(primeroCache(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(primeroRed(event));
  }
  // Otros orígenes (p. ej. tasa de cambio en vivo): comportamiento normal del navegador
});
