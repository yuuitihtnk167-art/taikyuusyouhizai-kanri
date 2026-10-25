const CACHE_NAME = "durable-goods-pwa-v157";
const BASE_URL = new URL(self.registration.scope);
const APP_SHELL = [
  "./",
  "index.html",
  "login.html",
  "list.html",
  "hidden.html",
  "form.html",
  "settings.html",
  "style.css?v=130",
  "style.css?v=157",
  "assets/login-hero.png",
  "js/common.js",
  "js/login.js",
  "js/list.js?v=157",
  "js/form.js",
  "js/settings.js?v=157",
  "js/platform/firebase.js",
  "js/platform/local-db.js",
  "js/services/app-settings.js",
  "js/services/monthly-summary.js?v=157",
  "js/services/japanese-holidays.js?v=156",
  "js/services/japanese-holiday-calendar.js?v=157",
  "js/services/holiday-update.js?v=157",
  "js/vendor/japanese-holidays-1.0.10.js",
  "js/services/monthly-summary-settings.js?v=157",
  "js/services/category-order.js",
  "js/services/timeline-marker-tooltip.js?v=154",
  "js/services/timeline-day-controls.js?v=157",
  "js/services/timeline-purchase-graph.js?v=150",
  "js/services/timeline-graph-viewport.js?v=155",
  "js/services/auth.js",
  "js/services/pc-summary.js?v=157",
  "js/storage/durable-items/firestore.js",
  "js/storage/durable-items/index.js",
  "js/storage/durable-items/local.js",
  "js/storage/durable-items/service.js",
  "js/storage/pc-items/firestore.js",
  "js/storage/pc-items/index.js",
  "js/storage/pc-items/local.js",
  "pc-management/index.html",
  "pc-management/specs.html",
  "pc-management/form.html",
  "pc-management/hidden.html",
  "pc-management/settings.html",
  "pc-management/manifest.webmanifest",
  "pc-management/pwa.css",
  "pc-management/pwa.js",
  "pc-management/settings.js",
  "pc-management/styles.css",
  "pc-management/app.js?v=157",
  "pc-management/icons/icon-192.png",
  "pc-management/icons/icon-512.png",
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
        return caches.match(event.request).then(async (cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (isNavigationRequest(event.request)) {
            // Serve the cached page while keeping navigation parameters in the browser URL.
            const pageUrl = new URL(event.request.url);
            pageUrl.search = "";
            const cachedPage = await caches.match(pageUrl.href);
            return cachedPage || caches.match(FALLBACK_URL);
          }
          return Response.error();
        });
      })
  );
});
