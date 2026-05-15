// drives the multi-step booking flow on /bookings
(function () {
    "use strict";

    var configEl = document.getElementById("bk-cfg");
    var BOOKING_IS_LOGGED_IN = configEl !== null && configEl.getAttribute("data-logged-in") === "true";

    var STORAGE_KEY = "ak_booking_state";                                                                       // localStorage key, used so we can survive a page reload after the user logs in

    var PACKAGE_DATA = {
        "1_ride":  {label: "1 Session",  cents: 3750},
        "2_rides": {label: "2 Sessions", cents: 6500},
        "3_rides": {label: "3 Sessions", cents: 8500},
        "4_plus":  {label: "Custom",     cents: null},
    };

    var bookingState = {
        step:        1,                                                                                         // current visible step (1-5)
        adultCount:  0,                                                                                         // number of 16+ drivers
        juniorCount: 0,                                                                                         // number of 8-15 drivers
        packageId:   "1_ride",                                                                                  // default package — also pre-selected visually
        extraRides:  1,                                                                                         // only meaningful when packageId === "4_plus"
        date:        null,                                                                                      // ISO date string YYYY-MM-DD (or null until picked)
        timeSlot:    null,                                                                                      // hour 0-23
        bookingId:   null,                                                                                      // set after successful POST /api/bookings/create
        shareToken:  null,                                                                                      // set after successful create — used by the "copy share link" button
    };

    function fnSaveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bookingState));
        } catch (e) {}                                                                                          // localStorage can throw, silently ignore, worst case is the user loses progress
    }

    function fnLoadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) { return; }                                                                               // if nothing saved then keep defaults
            var parsed = JSON.parse(raw);
            if (parsed.step        !== undefined) { bookingState.step        = parsed.step; }
            if (parsed.adultCount  !== undefined) { bookingState.adultCount  = parsed.adultCount; }
            if (parsed.juniorCount !== undefined) { bookingState.juniorCount = parsed.juniorCount; }
            if (parsed.packageId   !== undefined) { bookingState.packageId   = parsed.packageId; }
            if (parsed.extraRides  !== undefined) { bookingState.extraRides  = parsed.extraRides; }
            if (parsed.date        !== undefined) { bookingState.date        = parsed.date; }
            if (parsed.timeSlot    !== undefined) { bookingState.timeSlot    = parsed.timeSlot; }
            if (parsed.bookingId   !== undefined) { bookingState.bookingId   = parsed.bookingId; }
            if (parsed.shareToken  !== undefined) { bookingState.shareToken  = parsed.shareToken; }
        } catch (e) {}
    }

    function fnClearState() {                                                                                   // wipes saved state and resets to defaults, called after a booking is successfully made
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        bookingState.step        = 1;
        bookingState.adultCount  = 0;
        bookingState.juniorCount = 0;
        bookingState.packageId   = "1_ride";
        bookingState.extraRides  = 1;
        bookingState.date        = null;
        bookingState.timeSlot    = null;
        bookingState.bookingId   = null;
        bookingState.shareToken  = null;
    }

    function fnFormatCents(cents) {
        return "$" + (cents / 100).toFixed(2);
    }

    function fnFormatHour(hour) {
        if (hour === 0)  { return "12:00 AM"; }
        if (hour < 12)   { return hour + ":00 AM"; }
        if (hour === 12) { return "12:00 PM"; }
        return (hour - 12) + ":00 PM";
    }

    function fnFormatDateLong(dateString) {
        var parts = dateString.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
    }

    function fnFormatDateShort(dateString) {
        var parts = dateString.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
    }

    function fnCalculateTotal() {                                                                               // mirrors the server-side fn_calculate_total in models/booking.py
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        if (drivers < 1) { return 0; }                                                                          // no drivers chosen then show $0 in the summary
        if (bookingState.packageId === "1_ride")  { return drivers * 3750; }                                    // $37.50/person
        if (bookingState.packageId === "2_rides") { return drivers * 6500; }                                    // $65.00/person
        if (bookingState.packageId === "3_rides") { return drivers * 8500; }                                    // $85.00/person
        if (bookingState.packageId === "4_plus")  { return drivers * (8500 + bookingState.extraRides * 2000); } // 3 rides base + $20/extra ride
        return 0;
    }

    function fnSignalBarsHTML(status) {                                                                         // renders the 4-bar "busy meter" icon (think mobile reception bars), colour varies by slot status
        var fills = {                                                                                           // each value is the fill colour for bars 1..4 (shortest to tallest)
            "low":       ["#22c55e", "#22c55e", "#374151", "#374151"],                                 // 1 green
            "medium":    ["#eab308", "#eab308", "#eab308", "#374151"],                                 // 3 yellow
            "high":      ["#ef4444", "#ef4444", "#ef4444", "#ef4444"],                                 // all red
            "booked_out":["#4b5563", "#4b5563", "#4b5563", "#4b5563"],                                 // all grey
            "blocked":   ["#4b5563", "#4b5563", "#4b5563", "#4b5563"],                                 // all grey
        };
        var f = fills[status];
        if (!f) { f = fills["blocked"]; }                                                                       // fallback for unknown status
        return '<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">' +
            '<rect x="0" y="11" width="3" height="3" rx="0.5" fill="' + f[0] + '"/>' +
            '<rect x="5" y="8"  width="3" height="6" rx="0.5" fill="' + f[1] + '"/>' +
            '<rect x="10" y="4" width="3" height="10" rx="0.5" fill="' + f[2] + '"/>' +
            '<rect x="15" y="0" width="3" height="14" rx="0.5" fill="' + f[3] + '"/>' +
            '</svg>';
    }

    function fnStatusLabel(status) {                                                                            // text shown next to the bars (LOW/MEDIUM/HIGH/BOOKED OUT/CLOSED)
        if (status === "low")       { return '<span class="text-green-400 font-semibold text-xs">LOW</span>'; }
        if (status === "medium")    { return '<span class="text-yellow-400 font-semibold text-xs">MEDIUM</span>'; }
        if (status === "high")      { return '<span class="text-red-400 font-semibold text-xs">HIGH</span>'; }
        if (status === "booked_out"){ return '<span class="text-ak-muted font-semibold text-xs">BOOKED OUT</span>'; }
        if (status === "blocked")   { return '<span class="text-ak-muted font-semibold text-xs">CLOSED</span>'; }
        return '<span class="text-ak-muted font-semibold text-xs">CLOSED</span>';
    }

    function fnGetStepperIndex(step) {
        if (step <= 2) { return step; }
        if (step === 3) { return 2; }
        if (step === 4) { return 3; }
        return 4;
    }

    function fnUpdateStepper() {
        var active = fnGetStepperIndex(bookingState.step);
        for (var i = 1; i <= 4; i++) {
            var circle = document.getElementById("stepper-circle-" + i);
            var line   = document.getElementById("stepper-line-" + i);
            if (!circle) { continue; }
            if (i < active) {
                circle.className = "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all bg-ak-purple border-ak-purple text-white";
                circle.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
                var label = circle.nextElementSibling;
                if (label) { label.className = "text-xs mt-1.5 font-medium text-white text-center leading-tight"; }
                if (line) { line.className = "h-0.5 w-12 mb-5 bg-ak-purple transition-all"; }
            } else if (i === active) {
                circle.className = "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all bg-ak-purple border-ak-purple text-white";
                circle.innerHTML = i;
                var label2 = circle.nextElementSibling;
                if (label2) { label2.className = "text-xs mt-1.5 font-medium text-white text-center leading-tight"; }
                if (line) { line.className = "h-0.5 w-12 mb-5 bg-ak-border transition-all"; }
            } else {
                circle.className = "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all border-ak-border text-ak-muted";
                circle.innerHTML = i;
                var label3 = circle.nextElementSibling;
                if (label3) { label3.className = "text-xs mt-1.5 font-medium text-ak-muted text-center leading-tight"; }
                if (line) { line.className = "h-0.5 w-12 mb-5 bg-ak-border transition-all"; }
            }
        }
    }


    function fnUpdateStep1UI() {                                                                                // re-renders driver counters + package card selection state
        var adultEl  = document.getElementById("adult-count");
        var juniorEl = document.getElementById("junior-count");
        if (adultEl)  { adultEl.textContent  = bookingState.adultCount; }
        if (juniorEl) { juniorEl.textContent  = bookingState.juniorCount; }

        var cards = document.querySelectorAll(".booking-pkg-card");
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var pkg  = card.getAttribute("data-pkg");                                                           // each card has data-pkg="1_ride" etc
            var sel  = card.querySelector(".pkg-selected");                                                     // shown when selected
            var unsel = card.querySelector(".pkg-select");                                                      // shown when not selected
            if (pkg === bookingState.packageId) {
                card.classList.add("border-ak-purple");
                card.classList.remove("border-ak-border");
                if (sel)   { sel.classList.remove("hidden"); }
                if (unsel) { unsel.classList.add("hidden"); }
            } else {
                card.classList.remove("border-ak-purple");
                card.classList.add("border-ak-border");
                if (sel)   { sel.classList.add("hidden"); }
                if (unsel) { unsel.classList.remove("hidden"); }
            }
        }

        // Show/hide the +/- extra rides counter only when the "Custom" (4_plus) package is selected
        var extraControls = document.getElementById("extra-rides-controls");
        if (extraControls) {
            if (bookingState.packageId === "4_plus") {
                extraControls.classList.remove("hidden");
            } else {
                extraControls.classList.add("hidden");
            }
        }

        var extraCountEl = document.getElementById("extra-count");
        if (extraCountEl) { extraCountEl.textContent = bookingState.extraRides; }

        fnUpdateExtraRidesDisplay();                                                                            // refreshes "Xx sessions" + per-person price on the custom card
        fnUpdateProceedButton();                                                                                // enables/disables the proceed button based on whether step 1 is valid
    }

    function fnUpdateExtraRidesDisplay() {                                                                      // updates the "3 + extra = total rides" label and price on the Custom card
        var display  = document.getElementById("extra-rides-display");
        var priceEl  = document.getElementById("custom-price-display");
        var rides = 3 + bookingState.extraRides;                                                                // custom package = 3 base rides + N extras
        if (display) { display.textContent = rides; }
        if (priceEl) {
            var perPerson = (8500 + bookingState.extraRides * 2000) / 100;                                      // same formula as fnCalculateTotal / fn_calculate_total
            priceEl.innerHTML = "$" + perPerson.toFixed(2) + '<span class="text-ak-muted text-xs font-normal"> /person</span>';
        }
    }

    function fnUpdateProceedButton() {                                                                          // disables "Proceed" until the current step has the minimum required data
        var btn = document.getElementById("btn-proceed");
        if (!btn) { return; }
        if (bookingState.step === 1) {
            var drivers = bookingState.adultCount + bookingState.juniorCount;
            btn.disabled = drivers < 1;                                                                         // need at least 1 driver before proceeding
        } else if (bookingState.step === 2) {
            btn.disabled = bookingState.date === null || bookingState.timeSlot === null;                        // need both a date and a slot before proceeding
        } else {
            btn.disabled = false;                                                                               // step 4 (confirm) is always enabled, the click handler does the work
        }
    }

    function fnUpdateDateDisplay(dateString) {                                                                  // shows the long-format date underneath the picker once one is chosen
        var displayEl = document.getElementById("date-display");
        if (!displayEl) { return; }
        if (dateString) {
            displayEl.textContent = fnFormatDateLong(dateString);
            displayEl.classList.remove("hidden");
        } else {
            displayEl.classList.add("hidden");
        }
    }

    async function fnFetchSlots(dateString) {                                                                   // hits GET /api/bookings/slots and returns the parsed json
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        if (drivers < 1) { drivers = 1; }
        var url = "/api/bookings/slots?date=" + dateString + "&total_drivers=" + drivers;
        try {
            var response = await fetch(url, {credentials: "same-origin"});                                      // same-origin so the session cookie travels with the request
            var json = await response.json();
            return json;
        } catch (e) {
            return null;
        }
    }

    function fnRenderSlots(slotData) {                                                                          // takes the result from fnFetchSlots and paints the slots grid
        var loadingEl  = document.getElementById("slots-loading");
        var blockedEl  = document.getElementById("slots-blocked");
        var emptyEl    = document.getElementById("slots-empty");
        var gridEl     = document.getElementById("slots-grid");
        var containerEl = document.getElementById("slots-container");

        if (loadingEl)  { loadingEl.classList.add("hidden"); }
        if (blockedEl)  { blockedEl.classList.add("hidden"); }
        if (emptyEl)    { emptyEl.classList.add("hidden"); }
        if (gridEl)     { gridEl.classList.add("hidden"); }

        if (!slotData) {
            if (emptyEl) {
                emptyEl.textContent = "Could not load times. Please try again.";
                emptyEl.classList.remove("hidden");
            }
            return;
        }

        if (slotData.blocked) {                                                                                 // entire day is blocked (public holiday, private event etc)
            var reasonEl = document.getElementById("slots-blocked-reason");
            var reason = slotData.reason;
            if (!reason) { reason = "This date is not available for bookings."; }
            if (reasonEl) { reasonEl.textContent = reason; }
            if (blockedEl) { blockedEl.classList.remove("hidden"); }
            return;
        }

        var slots = slotData.slots;
        if (!slots || slots.length === 0) {                                                                     // shouldnt normally happen but defend against it
            if (emptyEl) {
                emptyEl.textContent = "No time slots available for this date.";
                emptyEl.classList.remove("hidden");
            }
            return;
        }

        if (!containerEl) { return; }
        containerEl.innerHTML = "";                                                                             // clear old slot buttons before painting new ones

        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];
            var isAvailable = slot.status !== "booked_out" && slot.status !== "blocked";                        // these statuses are "click does nothing"
            var isSelected  = bookingState.timeSlot === slot.hour;                                              // highlight the previously-selected slot if user already picked one

            var btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("data-hour", slot.hour);                                                           // we read this on click to update bookingState.timeSlot
            btn.setAttribute("data-status", slot.status);                                                       // and this to know if the click should do anything

            var borderClass  = isSelected ? "border-ak-purple" : "border-ak-border";                            // purple border = selected
            var cursorClass  = isAvailable ? "cursor-pointer hover:border-ak-purple" : "cursor-not-allowed opacity-60";

            btn.className = "w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 bg-ak-card transition-all " + borderClass + " " + cursorClass;
            btn.disabled  = !isAvailable;

            btn.innerHTML =
                '<span class="text-white text-sm font-medium">' + slot.label + '</span>' +
                '<span class="flex items-center gap-1.5">' + fnSignalBarsHTML(slot.status) + fnStatusLabel(slot.status) + '</span>';

            if (isAvailable) {
                (function (hour) {
                    btn.addEventListener("click", function () {
                        fnOnSlotSelect(hour);
                    });
                }(slot.hour));
            }

            containerEl.appendChild(btn);
        }

        if (gridEl) { gridEl.classList.remove("hidden"); }
    }

    function fnOnSlotSelect(hour) {                                                                             // user clicked a slot, update state and re-style the buttons
        bookingState.timeSlot = hour;
        var buttons = document.querySelectorAll("#slots-container button");
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var btnHour = parseInt(btn.getAttribute("data-hour"), 10);
            var status  = btn.getAttribute("data-status");
            var available = status !== "booked_out" && status !== "blocked";
            if (btnHour === hour) {
                btn.classList.add("border-ak-purple");
                btn.classList.remove("border-ak-border");
            } else if (available) {                                                                             // dont touch unavailable buttons, keep them looking disabled
                btn.classList.remove("border-ak-purple");
                btn.classList.add("border-ak-border");
            }
        }
        fnUpdateProceedButton();                                                                                // proceed button needs to re-evaluate now that we have a slot
        fnSaveState();                                                                                          // persist in case of refresh / login redirect
    }

    async function fnOnDateChange() {                                                                           // fired when the user picks a date in the <input type="date">
        var input = document.getElementById("date-input");
        if (!input) { return; }
        var dateValue = input.value;
        bookingState.date     = dateValue;
        bookingState.timeSlot = null;                                                                           // changing the date clears any previously-selected slot
        fnUpdateDateDisplay(dateValue);
        fnUpdateProceedButton();
        fnSaveState();

        if (!dateValue) { return; }                                                                             // user cleared the input

        var loadingEl = document.getElementById("slots-loading");
        var gridEl    = document.getElementById("slots-grid");
        var emptyEl   = document.getElementById("slots-empty");
        var blockedEl = document.getElementById("slots-blocked");

        if (loadingEl)  { loadingEl.classList.remove("hidden"); }
        if (gridEl)     { gridEl.classList.add("hidden"); }
        if (emptyEl)    { emptyEl.classList.add("hidden"); }
        if (blockedEl)  { blockedEl.classList.add("hidden"); }

        var result = await fnFetchSlots(dateValue);
        if (loadingEl) { loadingEl.classList.add("hidden"); }

        if (!result || !result.success) {                                                                       // either the network call failed or the API returned an error
            fnRenderSlots(null);
        } else {
            fnRenderSlots(result.data);                                                                         // result.data is {blocked, reason?, slots?}
        }
    }

    function fnInitStep2() {                                                                                    // sets up the date input 
        var input = document.getElementById("date-input");
        if (!input) { return; }

        var today = new Date();
        var maxDate = new Date(today);
        maxDate.setDate(maxDate.getDate() + 60);                                                                // can only book up to 60 days ahead

        function fnPad(n) { return n < 10 ? "0" + n : "" + n; }                                                 // html date inputs want zero-padded month/day
        var todayStr = today.getFullYear() + "-" + fnPad(today.getMonth() + 1) + "-" + fnPad(today.getDate());
        var maxStr   = maxDate.getFullYear() + "-" + fnPad(maxDate.getMonth() + 1) + "-" + fnPad(maxDate.getDate());

        input.setAttribute("min", todayStr);                                                                    // browser will disable past dates in the picker (server still re-validates)
        input.setAttribute("max", maxStr);                                                                      // and dates more than 60 days away

        if (bookingState.date) {                                                                                // user already picked a date earlier
            input.value = bookingState.date;
            fnUpdateDateDisplay(bookingState.date);
            fnOnDateChange();
        } else {
            var emptyEl = document.getElementById("slots-empty");
            if (emptyEl) {
                emptyEl.textContent = "Select a date above to see available times.";
                emptyEl.classList.remove("hidden");
            }
        }

        input.removeEventListener("change", fnOnDateChange);
        input.addEventListener("change", fnOnDateChange);
    }

    function fnUpdateSummary() {
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        var driverStr = "";
        if (bookingState.adultCount > 0)  { driverStr += bookingState.adultCount + " adult" + (bookingState.adultCount > 1 ? "s" : ""); }    // handles pluralization
        if (bookingState.juniorCount > 0) {
            if (driverStr) { driverStr += ", "; }                                                               // comma between adults & juniors when both exist
            driverStr += bookingState.juniorCount + " junior" + (bookingState.juniorCount > 1 ? "s" : "");
        }

        var pkgData = PACKAGE_DATA[bookingState.packageId];
        var pkgLabel = pkgData ? pkgData.label : bookingState.packageId;
        if (bookingState.packageId === "4_plus") {
            pkgLabel = (3 + bookingState.extraRides) + " Sessions";                                             // custom packages get a more useful label
        }

        var dateStr = bookingState.date ? fnFormatDateShort(bookingState.date) : "";
        var timeStr = bookingState.timeSlot !== null ? fnFormatHour(bookingState.timeSlot) : "";

        var el = document.getElementById("summary-date");    if (el) { el.textContent = dateStr; }
        el = document.getElementById("summary-time");        if (el) { el.textContent = timeStr; }
        el = document.getElementById("summary-drivers");     if (el) { el.textContent = driverStr; }
        el = document.getElementById("summary-package");     if (el) { el.textContent = pkgLabel; }
        el = document.getElementById("summary-total");       if (el) { el.textContent = fnFormatCents(fnCalculateTotal()); }
    }


    function fnUpdateConfirmation(bookingId) {                                                                  // fills in the success-screen booking details after a booking is created
        var ref = bookingId ? bookingId.slice(-6).toUpperCase() : "";
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        var driverStr = "";
        if (bookingState.adultCount > 0)  { driverStr += bookingState.adultCount + " adult" + (bookingState.adultCount > 1 ? "s" : ""); }
        if (bookingState.juniorCount > 0) {
            if (driverStr) { driverStr += ", "; }
            driverStr += bookingState.juniorCount + " junior" + (bookingState.juniorCount > 1 ? "s" : "");
        }
        var pkgLabel = bookingState.packageId === "4_plus"
            ? (3 + bookingState.extraRides) + " Sessions"
            : (PACKAGE_DATA[bookingState.packageId] ? PACKAGE_DATA[bookingState.packageId].label : "");

        var el = document.getElementById("conf-ref");        if (el) { el.textContent = ref; }
        el = document.getElementById("conf-date");           if (el) { el.textContent = bookingState.date ? fnFormatDateShort(bookingState.date) : ""; }
        el = document.getElementById("conf-time");           if (el) { el.textContent = bookingState.timeSlot !== null ? fnFormatHour(bookingState.timeSlot) : ""; }
        el = document.getElementById("conf-drivers");        if (el) { el.textContent = driverStr; }
        el = document.getElementById("conf-package");        if (el) { el.textContent = pkgLabel; }
        el = document.getElementById("conf-total");          if (el) { el.textContent = fnFormatCents(fnCalculateTotal()); }
    }

    async function fnConfirmBooking() {
        var btn     = document.getElementById("btn-proceed");
        var errorEl = document.getElementById("payment-error");

        if (btn)     { btn.disabled = true; btn.textContent = "Confirming…"; }                                  // prevent double-clicks while the request is in-flight
        if (errorEl) { errorEl.classList.add("hidden"); }

        var payload = {
            date:        bookingState.date,
            time_slot:   bookingState.timeSlot,
            adult_count: bookingState.adultCount,
            junior_count: bookingState.juniorCount,
            package_id:  bookingState.packageId,
            extra_rides: bookingState.extraRides,
        };

        try {
            var response = await fetch("/api/bookings/create", {
                method:      "POST",
                headers:     {"Content-Type": "application/json"},
                credentials: "same-origin",                                                                     // include session cookie so @fn_login_required sees the user
                body:        JSON.stringify(payload),
            });
            var data = await response.json();

            if (data.success) {
                bookingState.bookingId  = data.data.booking_id;                                                 // remember these so the share button on step 5 works
                bookingState.shareToken = data.data.share_token;
                bookingState.step       = 5;
                fnUpdateConfirmation(data.data.booking_id);
                fnRenderStep();
                fnClearState();                                                                                 // state no longer needed after booking — next visit should start fresh
            } else {
                var errMsg = "Something went wrong. Please try again.";
                if (data.error) { errMsg = data.error; }
                if (errorEl) {
                    errorEl.textContent = errMsg;
                    errorEl.classList.remove("hidden");
                }
                if (btn) {
                    btn.disabled     = false;
                    btn.innerHTML    = 'Confirm Booking <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
                }
            }
        } catch (networkErr) {
            if (errorEl) {
                errorEl.textContent = "Network error. Please try again.";
                errorEl.classList.remove("hidden");
            }
            if (btn) {
                btn.disabled     = false;
                btn.innerHTML    = 'Confirm Booking <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
            }
        }
    }


    function fnSetupBookingLoginForm() {                                                                        // wires up the inline login form shown on step 3
        var form    = document.getElementById("booking-login-form");
        var errorEl = document.getElementById("booking-login-error");
        if (!form) { return; }

        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            if (errorEl) { errorEl.classList.add("hidden"); }

            var emailInput    = document.getElementById("bl-email");
            var passwordInput = document.getElementById("bl-password");
            var email         = emailInput ? emailInput.value.trim() : "";
            var password      = passwordInput ? passwordInput.value : "";

            if (!email || !password) {
                if (errorEl) { errorEl.textContent = "Please enter your email and password."; errorEl.classList.remove("hidden"); }
                return;
            }

            try {
                var response = await fetch("/api/auth/login", {
                    method:      "POST",
                    headers:     {"Content-Type": "application/json"},
                    credentials: "same-origin",
                    body:        JSON.stringify({email: email, password: password, next: "/bookings"}),
                });
                var data = await response.json();
                if (data.success) {
                    var redirect = "/bookings";
                    if (data.data && data.data.redirect) { redirect = data.data.redirect; }
                    window.location.href = redirect;
                } else {
                    var errMsg = "Invalid email or password.";
                    if (data.error) { errMsg = data.error; }
                    if (errorEl) { errorEl.textContent = errMsg; errorEl.classList.remove("hidden"); }
                }
            } catch (netErr) {
                if (errorEl) { errorEl.textContent = "Network error. Please try again."; errorEl.classList.remove("hidden"); }
            }
        });
    }


    function fnShowStep(stepId) {                                                                               // hides every step container, then unhides the one we want
        var ids = ["step-1","step-2","step-3","step-4","step-5"];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (!el) { continue; }
            el.classList.add("hidden");
        }
        var target = document.getElementById("step-" + stepId);
        if (target) { target.classList.remove("hidden"); }
    }

    function fnRenderStep() {                                                                                   // central function that paints the correct step + stepper + nav buttons
        var s = bookingState.step;

        fnShowStep(s);
        fnUpdateStepper();
        fnSaveState();                                                                                          // every visible step change is persisted so we survive reloads

        var backBtn    = document.getElementById("btn-back");
        var proceedBtn = document.getElementById("btn-proceed");
        var navEl      = document.getElementById("step-nav");

        if (s === 1) {
            if (backBtn)    { backBtn.classList.add("hidden"); }
            if (proceedBtn) {
                proceedBtn.classList.remove("hidden");
                proceedBtn.innerHTML = 'Proceed <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
            }
            fnUpdateStep1UI();

        } else if (s === 2) {
            if (backBtn)    { backBtn.classList.remove("hidden"); }
            if (proceedBtn) {
                proceedBtn.classList.remove("hidden");
                proceedBtn.innerHTML = 'Proceed <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
            }
            fnInitStep2();
            fnUpdateProceedButton();

        } else if (s === 3) {
            if (backBtn)    { backBtn.classList.remove("hidden"); }
            if (proceedBtn) { proceedBtn.classList.add("hidden"); }

        } else if (s === 4) {
            if (backBtn)    { backBtn.classList.remove("hidden"); }
            if (proceedBtn) {
                proceedBtn.classList.remove("hidden");
                proceedBtn.disabled = false;
                proceedBtn.innerHTML = 'Confirm Booking <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
            }
            fnUpdateSummary();

        } else if (s === 5) {
            if (navEl) { navEl.classList.add("hidden"); }
        }
    }

    function fnProceed() {                                                                                       // proceed button
        var s = bookingState.step;

        if (s === 1) {
            var drivers = bookingState.adultCount + bookingState.juniorCount;
            if (drivers < 1) { return; }
            bookingState.step = 2;
            fnRenderStep();

        } else if (s === 2) {
            if (!bookingState.date || bookingState.timeSlot === null) { return; }
            if (BOOKING_IS_LOGGED_IN) {
                bookingState.step = 4;
            } else {
                bookingState.step = 3;
            }
            fnRenderStep();

        } else if (s === 3) {                                                                                   // step 3 has no "proceed" - its the log in
            

        } else if (s === 4) {
            fnConfirmBooking();                                                                                 // submit the booking
        }
    }

    function fnGoBack() {                                                                                       // back button
        var s = bookingState.step;
        if (s === 2) { bookingState.step = 1; }
        else if (s === 3) { bookingState.step = 2; }
        else if (s === 4) { bookingState.step = 2; }
        fnRenderStep();
    }

    function fnSetupShareButton() {                                                                             // wires up the "Copy share link" button on the success page
        var btn    = document.getElementById("btn-share-link");
        var msgEl  = document.getElementById("share-copied-msg");
        if (!btn) { return; }
        btn.addEventListener("click", function () {
            var token = bookingState.shareToken;
            if (!token) { return; }
            var url = window.location.origin + "/bookings/share/" + token;                                      // full URL so it's pasteable directly
            if (navigator.clipboard && navigator.clipboard.writeText) {
                // Modern async clipboard API
                navigator.clipboard.writeText(url).then(function () {
                    if (msgEl) { msgEl.classList.remove("hidden"); }
                }).catch(function () {
                    fnFallbackCopy(url, msgEl);
                });
            } else {
                fnFallbackCopy(url, msgEl);
            }
        });
    }

    function fnFallbackCopy(text, msgEl) {                                                                      // old-school copy method
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand("copy");
            if (msgEl) { msgEl.classList.remove("hidden"); }
        } catch (e) {}
        document.body.removeChild(ta);
    }


    function fnAttachEventListeners() {                                                                         // binds all the click handlers in one place
        var adultDec  = document.getElementById("adult-dec");
        var adultInc  = document.getElementById("adult-inc");
        var juniorDec = document.getElementById("junior-dec");
        var juniorInc = document.getElementById("junior-inc");
        var extraDec  = document.getElementById("extra-dec");
        var extraInc  = document.getElementById("extra-inc");
        var backBtn   = document.getElementById("btn-back");
        var proceedBtn = document.getElementById("btn-proceed");

        // driver +/- buttons
        if (adultDec)  { adultDec.addEventListener("click",  function () { if (bookingState.adultCount > 0)  { bookingState.adultCount--;  fnUpdateStep1UI(); fnSaveState(); } }); }
        if (adultInc)  { adultInc.addEventListener("click",  function () { bookingState.adultCount++;  fnUpdateStep1UI(); fnSaveState(); }); }
        if (juniorDec) { juniorDec.addEventListener("click", function () { if (bookingState.juniorCount > 0) { bookingState.juniorCount--; fnUpdateStep1UI(); fnSaveState(); } }); }
        if (juniorInc) { juniorInc.addEventListener("click", function () { bookingState.juniorCount++; fnUpdateStep1UI(); fnSaveState(); }); }
        // extra rides +/-
        if (extraDec)  { extraDec.addEventListener("click",  function () { if (bookingState.extraRides > 1)  { bookingState.extraRides--;  fnUpdateStep1UI(); fnSaveState(); } }); }
        if (extraInc)  { extraInc.addEventListener("click",  function () { bookingState.extraRides++;  fnUpdateStep1UI(); fnSaveState(); }); }

        // package cards
        var pkgCards = document.querySelectorAll(".booking-pkg-card");
        for (var i = 0; i < pkgCards.length; i++) {
            (function (card) {
                card.addEventListener("click", function () {
                    var pkg = card.getAttribute("data-pkg");
                    bookingState.packageId = pkg;
                    fnUpdateStep1UI();
                    fnSaveState();
                });
            }(pkgCards[i]));
        }

        if (backBtn)    { backBtn.addEventListener("click",    fnGoBack); }
        if (proceedBtn) { proceedBtn.addEventListener("click", fnProceed); }

        fnSetupBookingLoginForm();                                                                              // wires up the inline step-3 login form
        fnSetupShareButton();                                                                                   // wires up the step-5 copy-link button
    }

    function fnInit() {
        fnLoadState();                                                                                          // restore previous progress (if any) from localStorage

        if (bookingState.step === 3 && BOOKING_IS_LOGGED_IN) {
            bookingState.step = 4;
        }

        if (bookingState.step === 5 && !bookingState.shareToken) {
            fnClearState();
        }

        fnAttachEventListeners();
        fnRenderStep();
    }

    document.addEventListener("DOMContentLoaded", fnInit);
})();
