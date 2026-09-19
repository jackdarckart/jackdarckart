'use strict';

const CACHE_NAME = 'stream-musik-space-v3';
const OFFLINE_FALLBACK_URL = new URL('./index.html', self.location.href).href;
const APP_SHELL = [
  './',
  './index.html',
  './live.html',
  './titel.html',
  './sendeplan.html',
  './events.html',
  './news.html',
  './archiv.html',
  './ueber-uns.html',
  './hilfe.html',
  './issue-hilfe.html',
  './kontakt.html',
  './datenschutz.html',
  './impressum.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
  './assets/app-icon.svg',
  './assets/social-preview.png'
];
const STATIC_PAGE_PATHS = new Set(
  APP_SHELL
    .filter((asset) => asset === './' || asset.endsWith('.html'))
    .map((asset) => new URL(asset, self.location.href).pathname)
);

function isStaticPageRequest(request, url) {
  if (!request || !url) {
    return false;
  }

  return request.mode === 'navigate'
    || request.destination === 'document'
    || STATIC_PAGE_PATHS.has(url.pathname);
}

function scheduleCachePut(event, request, response) {
  const cacheWrite = caches.open(CACHE_NAME)
    .then((cache) => cache.put(request, response))
    .catch(() => null);
  if (event && typeof event.waitUntil === 'function') {
    event.waitUntil(cacheWrite);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(APP_SHELL.map(async (asset) => {
        try {
          await cache.add(asset);
        } catch (error) {
          return null;
        }
        return asset;
      }));
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key !== CACHE_NAME)
      .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request || request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const scopeUrl = new URL('./', self.location.href);
  const scopePath = scopeUrl.pathname;
  const relativePath = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.replace(/^\/+/, '');
  const useQuerylessKey = STATIC_PAGE_PATHS.has(url.pathname);
  const normalizedPageUrl = new URL((relativePath || './') + (useQuerylessKey ? '' : url.search), scopeUrl).href;

  if (request.destination === 'audio') {
    return;
  }

  if (isStaticPageRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const responseClone = response.clone();
            scheduleCachePut(event, normalizedPageUrl, responseClone);
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(normalizedPageUrl);
          if (cachedPage) {
            return cachedPage;
          }
          const exactRequestMatch = await caches.match(request);
          if (exactRequestMatch) {
            return exactRequestMatch;
          }
          return caches.match(OFFLINE_FALLBACK_URL);
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseClone = response.clone();
        scheduleCachePut(event, request, responseClone);
        return response;
      });
    })
  );
});
