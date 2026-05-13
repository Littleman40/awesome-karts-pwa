if ("serviceWorker" in navigator) {                                                     // registers service worker for offline capabilities
    window.addEventListener("load", function () {
        navigator.serviceWorker
            .register("/sw.js")
            .then(function (serviceWorkerRegistration) {
                console.log("Service worker registered:", serviceWorkerRegistration.scope);
            })
            .catch(function (registrationError) {
                console.error("Service worker registration failed:", registrationError);
            });
    });
}
