// polls the booking status after a stripe checkout redirect - landing here doesnt mean it was a success
(function () {

    // strict mode, which gives errors for undeclared variables and other bad practices
    "use strict";

    // reads config values embedded in the page by the server
    var cfgEl = document.getElementById("success-cfg");
    var BOOKING_ID = cfgEl ? cfgEl.getAttribute("data-booking-id") : "";

    // authorises the status poll without relying on the session cookie
    var SHARE_TOKEN = cfgEl ? (cfgEl.getAttribute("data-token") || "") : "";

    // how often we re-check the status
    var POLL_INTERVAL_MS = 2000;

    // maximum number of times we will try before showing a timeout message
    var MAX_ATTEMPTS = 30;
    var attempts = 0;
    var shareToken = "";



    // hides all state panels and shows only the one with the given id
    function fnShow(stateId) {
        var ids = ["confirming-state", "confirmed-state", "failed-state", "timeout-state"];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);

            // hide every panel first
            if (el) { el.classList.add("hidden"); }
        }

        // then show just the target panel
        var target = document.getElementById(stateId);
        if (target) { target.classList.remove("hidden"); }
    }



    // formats a number of cents as a dollar amount string
    function fnFormatCents(cents) {
        return "$" + ((cents || 0) / 100).toFixed(2);
    }



    // takes a date string like "2026-05-24" and returns a short readable date like "Sun 24 May"
    function fnFormatDate(isoDate) {
        if (!isoDate) { return ""; }

        // splits the date string into year, month, day
        var parts = isoDate.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
    }



    // builds a human readable string like "2 adults, 1 junior" from the booking object
    function fnDriverString(booking) {
        var parts = [];

        // only include adult or junior counts if they are greater than zero
        if (booking.adult_count > 0)  { parts.push(booking.adult_count + " adult" + (booking.adult_count > 1 ? "s" : "")); }
        if (booking.junior_count > 0) { parts.push(booking.junior_count + " junior" + (booking.junior_count > 1 ? "s" : "")); }
        return parts.join(", ");
    }



    // fills in the confirmed booking details panel and shows it
    function fnRenderConfirmed(booking) {

        // booking is paid - clear saved progress so a later visit to /bookings starts fresh at step 1
        try { localStorage.removeItem("ak_booking_state"); } catch (e) {}
        shareToken = booking.share_token || "";

        // shorthand helper to set text content of an element by id
        var set = function (id, value) { var el = document.getElementById(id); if (el) { el.textContent = value; } };
        set("conf-ref", booking.ref || "");
        set("conf-date", fnFormatDate(booking.date));
        set("conf-time", booking.time_label || "");
        set("conf-drivers", fnDriverString(booking));
        set("conf-package", booking.package_label || "");
        set("conf-total", fnFormatCents(booking.total_amount));

        // switch the ui to the confirmed panel
        fnShow("confirmed-state");
    }



    // wires up the "copy share link" button to copy the booking share url to clipboard
    function fnSetupShareButton() {
        var btn   = document.getElementById("btn-share-link");
        var msgEl = document.getElementById("share-copied-msg");

        // if the button doesnt exist on this page just return
        if (!btn) { return; }
        btn.addEventListener("click", function () {

            // does nothing if we dont have a share token yet
            if (!shareToken) { return; }

            // builds the full shareable url
            var url = window.location.origin + "/bookings/share/" + shareToken;

            // tries the modern clipboard api first, falls back to the old method
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function () {
                    if (msgEl) { msgEl.classList.remove("hidden"); }
                }).catch(function () { fnFallbackCopy(url, msgEl); });
            } else {
                fnFallbackCopy(url, msgEl);
            }
        });
    }



    // copies text to clipboard using the old textarea trick for browsers without the clipboard api
    function fnFallbackCopy(text, msgEl) {

        // creates a hidden textarea, selects its contents, and runs the copy command
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand("copy"); if (msgEl) { msgEl.classList.remove("hidden"); } } catch (e) {}
        document.body.removeChild(ta);
    }



    // checks the booking status on the server and repeats until it is paid, failed, or timed out
    async function fnPoll() {
        attempts++;
        try {

            // builds the status url, adding the share token if we have one
            var statusUrl = "/api/bookings/" + encodeURIComponent(BOOKING_ID) + "/status";
            if (SHARE_TOKEN) { statusUrl += "?token=" + encodeURIComponent(SHARE_TOKEN); }
            var response = await fetch(statusUrl, {credentials: "same-origin"});
            var data = await response.json();

            // if the server returned data, check the payment status
            if (data.success && data.data) {
                var status = data.data.status;

                // if paid, render the confirmation panel and stop polling
                if (status === "paid") {
                    fnRenderConfirmed(data.data.booking || {});
                    return;
                }

                // if cancelled or refunded, show the failed panel and stop polling
                if (status === "cancelled" || status === "refunded") {
                    fnShow("failed-state");
                    return;
                }
            }
        } catch (e) {
            // network blip - just try again on the next tick
        }

        // if we have hit the max attempts, show the timeout panel
        if (attempts >= MAX_ATTEMPTS) {
            fnShow("timeout-state");
            return;
        }

        // schedule the next poll
        setTimeout(fnPoll, POLL_INTERVAL_MS);
    }



    // sets up the page and starts polling for the payment result
    function fnInit() {

        // Landing on this page means Stripe completed the payment flow (it only redirects here afterwards).
        // Clear the abandoned-checkout marker immediately so that navigating to /bookings during the brief
        // window before the webhook marks us "paid" can't accidentally release this booking.
        try { localStorage.removeItem("ak_pending_booking_id"); } catch (e) {}

        fnSetupShareButton();

        // if there is no booking id in the page config, show timeout straight away
        if (!BOOKING_ID) { fnShow("timeout-state"); return; }

        // start the polling loop
        fnPoll();
    }

    document.addEventListener("DOMContentLoaded", fnInit);
})();
