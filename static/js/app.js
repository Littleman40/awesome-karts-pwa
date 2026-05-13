if ("serviceWorker" in navigator) {                                    // loads service worker to allow for pwa and caching
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js")
            .then((reg) => console.log("Service worker registered:", reg.scope))
            .catch((err) => console.error("Service worker registration failed:", err));
    });
}
