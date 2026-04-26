const CACHE_NAME = "durable-goods-pwa-v38";
const BASE_URL = new URL(self.registration.scope);
const APP_SHELL = [
  "./",
  "index.html",
  "login.html",
  "list.html",
  "hidden.html",
  "form.html",
  "style.css",
  "js/common.js",
  "js/login.js",
  "js/list.js",
  "js/form.js",
  "pc-management/index.html",
  "pc-management/styles.css",
  "pc-management/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
].map((path) => new Request(new URL(path, BASE_URL).toString(), { cache: "reload" }));
const FALLBACK_URL = new URL("login.html", BASE_URL).toString();

function isSameOriginRequest(request) {
  return new URL(request.url).origin === BASE_URL.origin;
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

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

  if (!isSameOriginRequest(event.request)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
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
          if (cachedResponse) return cachedResponse;
          if (isNavigationRequest(event.request)) return caches.match(FALLBACK_URL);
          return Response.error();
        });
      })
  );
});
