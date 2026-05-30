// registers service worker for offline capabilities
if ("serviceWorker" in navigator) {
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
