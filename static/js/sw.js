const CACHE_NAME = "awesomekart-pwa-v1";                    // service worker for caching
const ASSETS = [                                            // cached items
    "/",
    "/static/icons/icon-dark-2000.png",
    "/static/icons/icon-light-2000.png",
    "/static/css/style.css",
    "/static/js/app.js",
    "/static/manifest.json",
    "/static/img/kart-jnr.png",
    "/static/img/kart-snr.png",
    "/static/img/track-map.png",
];

self.addEventListener("install", (event) => {                   // installs cache when its loaded
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
