var CACHE_NAME = "dev-cache";                                  // service worker for caching
var CACHED_ASSETS = [                                                   // cached items
    "/static/icons/icon-dark-2000.png",
    "/static/icons/icon-light-2000.png",
    "/static/js/app.js",
    "/static/manifest.json",
    "/static/img/kart-jnr.png",
    "/static/img/kart-snr.png",
    "/static/img/track-map.png",
];

self.addEventListener("install", function (installEvent) {              // installs cache as the pwa is installed
    installEvent.waitUntil(
        caches.open(CACHE_NAME).then(function (cacheStorage) {
            return cacheStorage.addAll(CACHED_ASSETS);
        })
    );
});

self.addEventListener("activate", function (activateEvent) {            // deletes old caches when new service worker is activated
    activateEvent.waitUntil(
        caches.keys().then(function (cacheKeyList) {
            var deletePromises = [];
            for (var i = 0; i < cacheKeyList.length; i++) {
                var cacheKeyName = cacheKeyList[i];
                if (cacheKeyName !== CACHE_NAME) {
                    deletePromises.push(caches.delete(cacheKeyName));
                }
            }
            return Promise.all(deletePromises);
        })
    );
});

self.addEventListener("fetch", function (fetchEvent) {                  // fetches the cached items when they are requested
    fetchEvent.respondWith(
        caches.match(fetchEvent.request).then(function (cachedResponse) {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(fetchEvent.request);
        })
    );
});
