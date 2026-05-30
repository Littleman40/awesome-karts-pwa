// polls the booking status after a stripe checkout redirect - landing here doesnt mean it was a success
(function () {
    "use strict";

    var cfgEl = document.getElementById("success-cfg");
    var BOOKING_ID = cfgEl ? cfgEl.getAttribute("data-booking-id") : "";

    // authorises the status poll without relying on the session cookie
    var SHARE_TOKEN = cfgEl ? (cfgEl.getAttribute("data-token") || "") : "";                    

    // how often we re-check the status
    var POLL_INTERVAL_MS = 2000;                                                    
    var MAX_ATTEMPTS = 30;
    var attempts = 0;
    var shareToken = "";

    function fnShow(stateId) {
        var ids = ["confirming-state", "confirmed-state", "failed-state", "timeout-state"];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el) { el.classList.add("hidden"); }
        }
        var target = document.getElementById(stateId);
        if (target) { target.classList.remove("hidden"); }
    }

    function fnFormatCents(cents) {
        return "$" + ((cents || 0) / 100).toFixed(2);
    }

    function fnFormatDate(isoDate) {
        if (!isoDate) { return ""; }
        var parts = isoDate.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
    }

    function fnDriverString(booking) {
        var parts = [];
        if (booking.adult_count > 0)  { parts.push(booking.adult_count + " adult" + (booking.adult_count > 1 ? "s" : "")); }
        if (booking.junior_count > 0) { parts.push(booking.junior_count + " junior" + (booking.junior_count > 1 ? "s" : "")); }
        return parts.join(", ");
    }

    function fnRenderConfirmed(booking) {

        // booking is paid - clear saved progress so a later visit to /bookings starts fresh at step 1
        try { localStorage.removeItem("ak_booking_state"); } catch (e) {}
        shareToken = booking.share_token || "";
        var set = function (id, value) { var el = document.getElementById(id); if (el) { el.textContent = value; } };
        set("conf-ref", booking.ref || "");
        set("conf-date", fnFormatDate(booking.date));
        set("conf-time", booking.time_label || "");
        set("conf-drivers", fnDriverString(booking));
        set("conf-package", booking.package_label || "");
        set("conf-total", fnFormatCents(booking.total_amount));
        fnShow("confirmed-state");
    }

    function fnSetupShareButton() {
        var btn   = document.getElementById("btn-share-link");
        var msgEl = document.getElementById("share-copied-msg");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
            if (!shareToken) { return; }
            var url = window.location.origin + "/bookings/share/" + shareToken;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(function () {
                    if (msgEl) { msgEl.classList.remove("hidden"); }
                }).catch(function () { fnFallbackCopy(url, msgEl); });
            } else {
                fnFallbackCopy(url, msgEl);
            }
        });
    }

    function fnFallbackCopy(text, msgEl) {
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

    async function fnPoll() {
        attempts++;
        try {
            var statusUrl = "/api/bookings/" + encodeURIComponent(BOOKING_ID) + "/status";
            if (SHARE_TOKEN) { statusUrl += "?token=" + encodeURIComponent(SHARE_TOKEN); }
            var response = await fetch(statusUrl, {credentials: "same-origin"});
            var data = await response.json();
            if (data.success && data.data) {
                var status = data.data.status;
                if (status === "paid") {
                    fnRenderConfirmed(data.data.booking || {});
                    return;
                }
                if (status === "cancelled" || status === "refunded") {
                    fnShow("failed-state");
                    return;
                }
            }
        } catch (e) {
            // network blip - just try again on the next tick
        }

        if (attempts >= MAX_ATTEMPTS) {
            fnShow("timeout-state");
            return;
        }
        setTimeout(fnPoll, POLL_INTERVAL_MS);
    }

    function fnInit() {
        fnSetupShareButton();
        if (!BOOKING_ID) { fnShow("timeout-state"); return; }
        fnPoll();
    }

    document.addEventListener("DOMContentLoaded", fnInit);
})();
