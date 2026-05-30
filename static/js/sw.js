var CACHE_NAME = "awesome-karts-v2";

// pre-cached so the shell works offline
var CACHED_ASSETS = [
    "/static/css/style.css",
    "/static/js/app.js",
    "/static/manifest.json",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
    "/static/icons/icon-maskable-512.png",
    "/static/img/kart-jnr.png",
    "/static/img/kart-snr.png",
    "/static/img/track-map.png",
    "/static/img/calendar.svg",
    "/static/img/cross.svg",
    "/static/img/dropdown.svg",
    "/static/img/left.svg",
    "/static/img/menu.svg",
    "/static/img/minus.svg",
    "/static/img/plus.svg",
    "/static/img/right.svg",
    "/static/img/share.svg",
    "/static/img/tick.svg",
    "/static/img/uprightarrow.svg",
];


// pre-caches the app shell as the service worker installs
self.addEventListener("install", function (installEvent) {
    installEvent.waitUntil(
        caches.open(CACHE_NAME).then(function (cacheStorage) {
            return cacheStorage.addAll(CACHED_ASSETS);
        })
    );

    // activate the new worker immediately
    self.skipWaiting();
});

// deletes old caches when a new service worker activates
self.addEventListener("activate", function (activateEvent) {
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

    // take control of open pages right away
    self.clients.claim();
});

self.addEventListener("fetch", function (fetchEvent) {
    var request = fetchEvent.request;

    // only handle GET - never cache POSTs (logins, bookings, etc.)
    if (request.method !== "GET") {
        return;
    }

    // API calls are dynamic - always go to the network, return a JSON error if offline
    if (request.url.indexOf("/api/") !== -1) {
        fetchEvent.respondWith(
            fetch(request).catch(function () {
                return new Response(
                    JSON.stringify({ success: false, error: "You are offline." }),
                    { headers: { "Content-Type": "application/json" } }
                );
            })
        );
        return;
    }

    // page navigations are network-first so content stays fresh, falling back to a cached copy if offline
    if (request.mode === "navigate") {
        fetchEvent.respondWith(
            fetch(request)
                .then(function (networkResponse) {
                    var responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(function (cacheStorage) {
                        cacheStorage.put(request, responseClone);
                    });
                    return networkResponse;
                })
                .catch(function () {
                    return caches.match(request);
                })
        );
        return;
    }

    // everything else (css, js, images) is cache-first for speed
    fetchEvent.respondWith(
        caches.match(request).then(function (cachedResponse) {
            return (
                cachedResponse ||
                fetch(request).then(function (networkResponse) {
                    var responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(function (cacheStorage) {
                        cacheStorage.put(request, responseClone);
                    });
                    return networkResponse;
                })
            );
        })
    );
});
