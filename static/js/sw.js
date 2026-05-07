const CACHE_NAME = "awesomekart-pwa-v1";
const ASSETS = [
    "/",
    "static/icons/icon-dark-2000.png",
    "static/icons/icon-light-2000.png",
    "/static/css/style.css",
    "/static/js/app.js",
    "/static/manifest.json",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
});

self.addEventListener("fetch", (event) => {
    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
