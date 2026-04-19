const CACHE_NAME = "durable-goods-pwa-v14";
const BASE_URL = new URL(self.registration.scope);
const APP_SHELL = [
  "./",
  "index.html",
  "login.html",
  "list.html",
  "form.html",
  "style.css",
  "js/common.js",
  "js/login.js",
  "js/list.js",
  "js/form.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
].map((path) => new URL(path, BASE_URL).toString());
const FALLBACK_URL = new URL("login.html", BASE_URL).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        const cloned = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          return cachedResponse || caches.match(FALLBACK_URL);
        });
      })
  );
});
