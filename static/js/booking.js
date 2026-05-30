// drives the multi-step booking flow on /bookings
(function () {
    "use strict";

    var configEl = document.getElementById("bk-cfg");
    var BOOKING_IS_LOGGED_IN = configEl !== null && configEl.getAttribute("data-logged-in") === "true";

    // localStorage key - used so we can survive a page reload after the user logs in
    var STORAGE_KEY = "ak_booking_state";

    var PACKAGE_DATA = {
        "1_ride":  {label: "1 Session",  cents: 3750},
        "2_rides": {label: "2 Sessions", cents: 6500},
        "3_rides": {label: "3 Sessions", cents: 8500},
        "4_plus":  {label: "Custom",     cents: null},
    };

    var bookingState = {
        step:        1,
        adultCount:  0,
        juniorCount: 0,
        packageId:   "1_ride",
        extraRides:  1,
        date:        null,
        timeSlot:    null,
    };

    function fnSaveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bookingState));
        } catch (e) {
            // localStorage can throw - silently ignore, worst case is the user loses progress
        }
    }

    function fnLoadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);

            // if nothing saved then keep defaults
            if (!raw) { return; }
            var parsed = JSON.parse(raw);
            if (parsed.step        !== undefined) { bookingState.step        = parsed.step; }
            if (parsed.adultCount  !== undefined) { bookingState.adultCount  = parsed.adultCount; }
            if (parsed.juniorCount !== undefined) { bookingState.juniorCount = parsed.juniorCount; }
            if (parsed.packageId   !== undefined) { bookingState.packageId   = parsed.packageId; }
            if (parsed.extraRides  !== undefined) { bookingState.extraRides  = parsed.extraRides; }
            if (parsed.date        !== undefined) { bookingState.date        = parsed.date; }
            if (parsed.timeSlot    !== undefined) { bookingState.timeSlot    = parsed.timeSlot; }
        } catch (e) {}
    }

    // wipes saved progress and resets to defaults
    function fnClearState() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        bookingState.step        = 1;
        bookingState.adultCount  = 0;
        bookingState.juniorCount = 0;
        bookingState.packageId   = "1_ride";
        bookingState.extraRides  = 1;
        bookingState.date        = null;
        bookingState.timeSlot    = null;
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

    // mirrors the server-side fn_calculate_total in models/booking.py
    function fnCalculateTotal() {
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        if (drivers < 1) { return 0; }
        if (bookingState.packageId === "1_ride")  { return drivers * 3750; }
        if (bookingState.packageId === "2_rides") { return drivers * 6500; }
        if (bookingState.packageId === "3_rides") { return drivers * 8500; }
        if (bookingState.packageId === "4_plus")  { return drivers * (8500 + bookingState.extraRides * 2000); }
        return 0;
    }

    // renders the 4-bar busy meter icon - colour varies by slot status
    function fnSignalBarsHTML(status) {
        var fills = {
            "low":       ["#22c55e", "#22c55e", "#374151", "#374151"],
            "medium":    ["#eab308", "#eab308", "#eab308", "#374151"],
            "high":      ["#ef4444", "#ef4444", "#ef4444", "#ef4444"],
            "booked_out":["#4b5563", "#4b5563", "#4b5563", "#4b5563"],
            "blocked":   ["#4b5563", "#4b5563", "#4b5563", "#4b5563"],
            "past":      ["#4b5563", "#4b5563", "#4b5563", "#4b5563"],
        };
        var f = fills[status];

        // fallback for unknown status
        if (!f) { f = fills["blocked"]; }
        return '<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">' +
            '<rect x="0" y="11" width="3" height="3" rx="0.5" fill="' + f[0] + '"/>' +
            '<rect x="5" y="8"  width="3" height="6" rx="0.5" fill="' + f[1] + '"/>' +
            '<rect x="10" y="4" width="3" height="10" rx="0.5" fill="' + f[2] + '"/>' +
            '<rect x="15" y="0" width="3" height="14" rx="0.5" fill="' + f[3] + '"/>' +
            '</svg>';
    }

    // text shown next to the bars (LOW / MEDIUM / HIGH / BOOKED OUT / CLOSED)
    function fnStatusLabel(status) {
        if (status === "low")       { return '<span class="text-green-400 font-semibold text-xs">LOW</span>'; }
        if (status === "medium")    { return '<span class="text-yellow-400 font-semibold text-xs">MEDIUM</span>'; }
        if (status === "high")      { return '<span class="text-red-400 font-semibold text-xs">HIGH</span>'; }
        if (status === "booked_out"){ return '<span class="text-ak-muted font-semibold text-xs">BOOKED OUT</span>'; }
        if (status === "blocked")   { return '<span class="text-ak-muted font-semibold text-xs">CLOSED</span>'; }
        if (status === "past")      { return '<span class="text-ak-muted font-semibold text-xs">PAST</span>'; }
        return '<span class="text-ak-muted font-semibold text-xs">CLOSED</span>';
    }

    function fnGetStepperIndex(step) {
        if (step <= 2) { return step; }

        // inline login still sits under the Date & Time node
        if (step === 3) { return 2; }
        return 3;
    }

    function fnUpdateStepper() {
        var active = fnGetStepperIndex(bookingState.step);
        for (var i = 1; i <= 3; i++) {
            var circle = document.getElementById("stepper-circle-" + i);
            var line   = document.getElementById("stepper-line-" + i);
            if (!circle) { continue; }
            if (i < active) {
                circle.className = "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all bg-ak-purple border-ak-purple text-white";
                circle.innerHTML = '<img src="/static/img/tick.svg" alt="" class="w-4 h-4 invert">';
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

    // re-renders driver counters + package card selection state
    function fnUpdateStep1UI() {
        var adultEl  = document.getElementById("adult-count");
        var juniorEl = document.getElementById("junior-count");
        if (adultEl)  { adultEl.textContent  = bookingState.adultCount; }
        if (juniorEl) { juniorEl.textContent  = bookingState.juniorCount; }

        var cards = document.querySelectorAll(".booking-pkg-card");
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];

            // each card has data-pkg="1_ride" etc
            var pkg  = card.getAttribute("data-pkg");

            // shown when selected
            var sel  = card.querySelector(".pkg-selected");

            // shown when not selected
            var unsel = card.querySelector(".pkg-select");

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

        // show/hide the +/- extra rides counter only when the "Custom" (4_plus) package is selected
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

        // refreshes "x sessions" + per-person price on the custom card
        fnUpdateExtraRidesDisplay();

        // enables/disables the proceed button based on whether step 1 is valid
        fnUpdateProceedButton();
    }

    // updates the "3 + extra = total rides" label and price on the Custom card
    function fnUpdateExtraRidesDisplay() {
        var display  = document.getElementById("extra-rides-display");
        var priceEl  = document.getElementById("custom-price-display");
        var rides = 3 + bookingState.extraRides;
        if (display) { display.textContent = rides; }
        if (priceEl) {
            var perPerson = (8500 + bookingState.extraRides * 2000) / 100;
            priceEl.innerHTML = "$" + perPerson.toFixed(2) + '<span class="text-ak-muted text-xs font-normal"> /person</span>';
        }
    }

    // disables "Proceed" until the current step has the minimum required data
    function fnUpdateProceedButton() {
        var btn = document.getElementById("btn-proceed");
        if (!btn) { return; }
        if (bookingState.step === 1) {
            var drivers = bookingState.adultCount + bookingState.juniorCount;

            // need at least 1 driver before proceeding
            btn.disabled = drivers < 1;

        } else if (bookingState.step === 2) {
            // need both a date and a slot before proceeding
            btn.disabled = bookingState.date === null || bookingState.timeSlot === null;

        } else {
            // step 4 (confirm) is always enabled, the click handler does the work
            btn.disabled = false;
        }
    }

    // converts a day number into 1st / 2nd / 3rd / 4th etc
    function fnDayOrdinal(n) {
        var lastTwo = n % 100;

        // 11th, 12th, 13th are exceptions to the usual st/nd/rd rule
        if (lastTwo >= 11 && lastTwo <= 13) { return "th"; }
        var last = n % 10;
        if (last === 1) { return "st"; }
        if (last === 2) { return "nd"; }
        if (last === 3) { return "rd"; }
        return "th";
    }

    // "Tuesday 26th May" - used in the calendar header to show the selected date
    function fnFormatDateNoYear(dateString) {
        var parts = dateString.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        var n = d.getDate();
        return days[d.getDay()] + " " + n + fnDayOrdinal(n) + " " + months[d.getMonth()];
    }

    // shows the selected date in the calendar header (right side)
    function fnUpdateDateDisplay(dateString) {
        var displayEl = document.getElementById("date-display");
        if (!displayEl) { return; }
        if (dateString) {
            displayEl.textContent = fnFormatDateNoYear(dateString);
        } else {
            displayEl.textContent = "";
        }
    }

    // hits GET /api/bookings/slots and returns the parsed json
    async function fnFetchSlots(dateString) {
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        if (drivers < 1) { drivers = 1; }
        var url = "/api/bookings/slots?date=" + dateString + "&total_drivers=" + drivers;
        try {
            var response = await fetch(url, {credentials: "same-origin"});
            var json = await response.json();
            return json;
        } catch (e) {
            return null;
        }
    }

    // renders grey placeholder buttons so the slot card holds its size while loading
    function fnRenderSkeletonSlots(count) {
        var containerEl = document.getElementById("slots-container");
        if (!containerEl) { return; }
        containerEl.innerHTML = "";
        var rows = Math.ceil(count / 2);

        // match the real layout so the swap-in is seamless
        containerEl.style.gridAutoFlow     = "column";
        containerEl.style.gridTemplateRows = "repeat(" + rows + ", auto)";
        for (var i = 0; i < count; i++) {
            var skel = document.createElement("div");
            skel.className = "w-full rounded-xl border-2 border-ak-border bg-ak-card animate-pulse";

            // matches a real slot button's outer height (py-3 + line)
            skel.style.height = "52px";
            containerEl.appendChild(skel);
        }
    }

    // takes the result from fnFetchSlots and paints the slots grid
    function fnRenderSlots(slotData) {
        var blockedEl   = document.getElementById("slots-blocked");
        var containerEl = document.getElementById("slots-container");

        if (blockedEl)    { blockedEl.classList.add("hidden"); }
        if (!containerEl) { return; }

        // network or api failure
        if (!slotData) {
            containerEl.innerHTML = '<p class="text-red-400 text-sm" style="grid-column: 1 / -1;">Could not load times. Please try again.</p>';
            containerEl.style.gridAutoFlow     = "row";
            containerEl.style.gridTemplateRows = "";
            return;
        }

        // entire day is blocked (public holiday, private event etc)
        if (slotData.blocked) {
            var reasonEl = document.getElementById("slots-blocked-reason");
            var reason = slotData.reason;
            if (!reason) { reason = "This date is not available for bookings."; }
            if (reasonEl)  { reasonEl.textContent = reason; }
            if (blockedEl) { blockedEl.classList.remove("hidden"); }

            // clear so the card collapses to just the blocked notice
            containerEl.innerHTML = "";
            containerEl.style.gridAutoFlow     = "row";
            containerEl.style.gridTemplateRows = "";
            return;
        }

        var slots = slotData.slots;

        // shouldnt normally happen but defend against it
        if (!slots || slots.length === 0) {
            containerEl.innerHTML = '<p class="text-ak-muted text-sm" style="grid-column: 1 / -1;">No time slots available for this date.</p>';
            containerEl.style.gridAutoFlow     = "row";
            containerEl.style.gridTemplateRows = "";
            return;
        }

        // clear old slot buttons before painting new ones
        containerEl.innerHTML = "";

        // mark hours already past on today's date as unavailable
        var todayIsoForSlots = fnFormatDateISO(fnGetTodayDate());
        var isTodaySelected  = (bookingState.date === todayIsoForSlots);
        var nowForSlots      = new Date();

        for (var i = 0; i < slots.length; i++) {
            var slot = slots[i];

            // override status if the hour has already started today
            if (isTodaySelected) {
                var dateParts = bookingState.date.split("-");
                var slotStart = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10), slot.hour, 0, 0);
                if (slotStart <= nowForSlots) {
                    slot.status = "past";
                }
            }

            // these statuses mean "click does nothing"
            var isAvailable = slot.status !== "booked_out" && slot.status !== "blocked" && slot.status !== "past";

            // highlight the previously-selected slot if the user already picked one
            var isSelected = bookingState.timeSlot === slot.hour;

            var btn = document.createElement("button");
            btn.type = "button";

            // we read these on click to update bookingState.timeSlot and decide if the click should do anything
            btn.setAttribute("data-hour",   slot.hour);
            btn.setAttribute("data-status", slot.status);

            // purple border = selected
            var borderClass = isSelected ? "border-ak-purple" : "border-ak-border";
            var cursorClass = isAvailable ? "cursor-pointer hover:border-ak-purple" : "cursor-not-allowed opacity-60";

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

        // column-major flow - first half fills col 1 top-to-bottom, second half col 2
        var rowCount = Math.ceil(slots.length / 2);
        containerEl.style.gridAutoFlow     = "column";
        containerEl.style.gridTemplateRows = "repeat(" + rowCount + ", auto)";
    }

    // user clicked a slot - update state and re-style the buttons
    function fnOnSlotSelect(hour) {
        bookingState.timeSlot = hour;
        var buttons = document.querySelectorAll("#slots-container button");
        for (var i = 0; i < buttons.length; i++) {
            var btn      = buttons[i];
            var btnHour  = parseInt(btn.getAttribute("data-hour"), 10);
            var status   = btn.getAttribute("data-status");
            var available = status !== "booked_out" && status !== "blocked";
            if (btnHour === hour) {
                btn.classList.add("border-ak-purple");
                btn.classList.remove("border-ak-border");
            } else if (available) {
                // dont touch unavailable buttons, keep them looking disabled
                btn.classList.remove("border-ak-purple");
                btn.classList.add("border-ak-border");
            }
        }

        // proceed button needs to re-evaluate now that we have a slot
        fnUpdateProceedButton();

        // persist in case of refresh / login redirect
        fnSaveState();
    }

    // how far ahead users can book - ~3 months
    var BOOKING_WINDOW_DAYS = 90;

    // 0 = today's month, 1 = next month, etc
    var calendarMonthOffset = 0;

    // local-time today at midnight, used everywhere we compare dates
    function fnGetTodayDate() {
        var d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    // last allowed booking date (today + window)
    function fnGetMaxBookingDate() {
        var d = fnGetTodayDate();
        d.setDate(d.getDate() + BOOKING_WINDOW_DAYS);
        return d;
    }

    // YYYY-MM-DD in local time (not UTC) so it matches what the user sees on their device
    function fnFormatDateISO(d) {
        function fnPad(n) { return n < 10 ? "0" + n : "" + n; }
        return d.getFullYear() + "-" + fnPad(d.getMonth() + 1) + "-" + fnPad(d.getDate());
    }

    // YYYY-MM-DD string -> local-time Date at midnight
    function fnParseDateISO(dateString) {
        var parts = dateString.split("-");
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }

    // paints the current month into #cal-grid - called on init and on month nav
    function fnRenderCalendar() {
        var titleEl = document.getElementById("cal-title");
        var gridEl  = document.getElementById("cal-grid");
        var prevBtn = document.getElementById("cal-prev");
        var nextBtn = document.getElementById("cal-next");
        if (!titleEl || !gridEl) { return; }

        var today   = fnGetTodayDate();
        var maxDate = fnGetMaxBookingDate();

        // resolve "current month + offset" into a concrete year/month
        var viewYear  = today.getFullYear();
        var viewMonth = today.getMonth() + calendarMonthOffset;

        // js normalises overflow (eg month=13 -> next year)
        var firstOfMonth = new Date(viewYear, viewMonth, 1);
        viewYear  = firstOfMonth.getFullYear();
        viewMonth = firstOfMonth.getMonth();

        var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

        // year is shown via the selected-date display on the right, no need to duplicate
        titleEl.textContent = monthNames[viewMonth];

        // cant go before today's month
        if (prevBtn) { prevBtn.disabled = (calendarMonthOffset <= 0); }
        if (nextBtn) {
            var nextMonthFirst = new Date(viewYear, viewMonth + 1, 1);

            // hide further months once entirely past the booking window
            nextBtn.disabled = (nextMonthFirst > maxDate);
        }

        gridEl.innerHTML = "";

        // 0 = Sunday, used to add leading blank cells so the week starts on the right column
        var firstDow    = new Date(viewYear, viewMonth, 1).getDay();

        // day 0 of next month = last day of this month
        var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        for (var b = 0; b < firstDow; b++) {
            var blank = document.createElement("div");
            blank.className = "h-9";
            gridEl.appendChild(blank);
        }

        for (var day = 1; day <= daysInMonth; day++) {
            var dayDate  = new Date(viewYear, viewMonth, day);
            var dayIso   = fnFormatDateISO(dayDate);

            // past or beyond the 3-month window
            var disabled = (dayDate < today) || (dayDate > maxDate);
            var selected = (bookingState.date === dayIso);
            var isToday  = (dayDate.getTime() === today.getTime());

            var cell = document.createElement("button");
            cell.type = "button";
            cell.textContent = day;
            cell.setAttribute("data-date", dayIso);

            var baseClass = "h-9 rounded-lg text-sm font-medium flex items-center justify-center transition-colors";
            if (disabled) {
                cell.className = baseClass + " text-ak-hint cursor-not-allowed opacity-40";
                cell.disabled = true;
            } else if (selected) {
                cell.className = baseClass + " bg-ak-purple text-white";
            } else if (isToday) {
                // today gets a subtle outline-style bg before selection
                cell.className = baseClass + " bg-ak-border text-white hover:bg-ak-purple cursor-pointer";
            } else {
                cell.className = baseClass + " text-white hover:bg-ak-border cursor-pointer";
            }

            if (!disabled) {
                (function (iso) {
                    cell.addEventListener("click", function () { fnSelectCalendarDate(iso); });
                }(dayIso));
            }
            gridEl.appendChild(cell);
        }
    }

    // user clicked a day cell - persist, refresh ui, reload slots
    function fnSelectCalendarDate(dateIso) {
        bookingState.date = dateIso;

        // any previously chosen slot is now meaningless on a new date
        bookingState.timeSlot = null;
        fnUpdateDateDisplay(dateIso);

        // re-render so the new cell shows as selected
        fnRenderCalendar();
        fnUpdateProceedButton();
        fnSaveState();
        fnLoadSlotsForDate(dateIso);
    }

    // fetches /api/bookings/slots and paints the result
    async function fnLoadSlotsForDate(dateIso) {
        var containerEl = document.getElementById("slots-container");
        var blockedEl   = document.getElementById("slots-blocked");

        if (blockedEl) { blockedEl.classList.add("hidden"); }

        if (containerEl) {
            // first paint: show skeletons; otherwise leave prior buttons in place so the card doesnt collapse
            var hasPriorButtons = containerEl.querySelector("button") !== null;
            if (!hasPriorButtons) {
                // 11 placeholders matches the typical opening-hours range
                fnRenderSkeletonSlots(11);
            }

            // dim whatever is currently visible so the user sees it is loading
            containerEl.classList.add("opacity-50", "pointer-events-none");
        }

        var result = await fnFetchSlots(dateIso);

        if (!result || !result.success) {
            fnRenderSlots(null);
        } else {
            fnRenderSlots(result.data);
        }

        if (containerEl) {
            containerEl.classList.remove("opacity-50", "pointer-events-none");
        }
    }

    // wires up the calendar widget and pre-selects today if no date is set
    function fnInitStep2() {
        var today    = fnGetTodayDate();
        var maxDate  = fnGetMaxBookingDate();
        var todayIso = fnFormatDateISO(today);

        // throw away saved dates that are outside the booking window
        if (bookingState.date) {
            var saved = fnParseDateISO(bookingState.date);
            if (saved < today || saved > maxDate) {
                bookingState.date     = null;
                bookingState.timeSlot = null;
            }
        }

        // pre-select today so the user immediately sees today's slots
        if (!bookingState.date) {
            bookingState.date = todayIso;
        }

        // align the visible month to the selected date
        var selDate = fnParseDateISO(bookingState.date);
        calendarMonthOffset = (selDate.getFullYear() - today.getFullYear()) * 12 + (selDate.getMonth() - today.getMonth());

        var prevBtn = document.getElementById("cal-prev");
        var nextBtn = document.getElementById("cal-next");
        if (prevBtn) {
            // onclick reassignment is fine - fnInitStep2 runs each time step 2 is shown
            prevBtn.onclick = function () {
                if (calendarMonthOffset > 0) { calendarMonthOffset--; fnRenderCalendar(); }
            };
        }
        if (nextBtn) {
            nextBtn.onclick = function () {
                var t = fnGetTodayDate();
                var mx = fnGetMaxBookingDate();
                var nextFirst = new Date(t.getFullYear(), t.getMonth() + calendarMonthOffset + 1, 1);
                if (nextFirst <= mx) { calendarMonthOffset++; fnRenderCalendar(); }
            };
        }

        fnRenderCalendar();
        fnUpdateDateDisplay(bookingState.date);
        fnLoadSlotsForDate(bookingState.date);
    }

    function fnUpdateSummary() {
        var drivers = bookingState.adultCount + bookingState.juniorCount;
        var driverStr = "";

        // handles pluralization
        if (bookingState.adultCount > 0)  { driverStr += bookingState.adultCount + " adult" + (bookingState.adultCount > 1 ? "s" : ""); }
        if (bookingState.juniorCount > 0) {
            // comma between adults & juniors when both are non-zero
            if (driverStr) { driverStr += ", "; }
            driverStr += bookingState.juniorCount + " junior" + (bookingState.juniorCount > 1 ? "s" : "");
        }

        var pkgData  = PACKAGE_DATA[bookingState.packageId];
        var pkgLabel = pkgData ? pkgData.label : bookingState.packageId;
        if (bookingState.packageId === "4_plus") {
            // custom packages get a more useful label than "Custom"
            pkgLabel = (3 + bookingState.extraRides) + " Sessions";
        }

        var dateStr = bookingState.date     ? fnFormatDateShort(bookingState.date)         : "";
        var timeStr = bookingState.timeSlot !== null ? fnFormatHour(bookingState.timeSlot) : "";

        var el = document.getElementById("summary-date");    if (el) { el.textContent = dateStr; }
        el     = document.getElementById("summary-time");    if (el) { el.textContent = timeStr; }
        el     = document.getElementById("summary-drivers"); if (el) { el.textContent = driverStr; }
        el     = document.getElementById("summary-package"); if (el) { el.textContent = pkgLabel; }
        el     = document.getElementById("summary-total");   if (el) { el.textContent = fnFormatCents(fnCalculateTotal()); }
    }

    // creates a pending booking server-side, then redirects to the Stripe-hosted checkout page
    async function fnStartCheckout() {
        var btn     = document.getElementById("btn-proceed");
        var errorEl = document.getElementById("payment-error");

        // prevent double-clicks while the request is in-flight
        if (btn)     { btn.disabled = true; btn.innerHTML = "Redirecting…"; }
        if (errorEl) { errorEl.classList.add("hidden"); }

        function fnResetButton() {
            if (btn) {
                btn.disabled  = false;
                btn.innerHTML = 'Proceed to Payment <img src="/static/img/right.svg" alt="" class="w-4 h-4 inline invert">';
            }
        }
        function fnShowError(msg) {
            if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove("hidden"); }
        }

        var payload = {
            date:         bookingState.date,
            time_slot:    bookingState.timeSlot,
            adult_count:  bookingState.adultCount,
            junior_count: bookingState.juniorCount,
            package_id:   bookingState.packageId,
            extra_rides:  bookingState.extraRides,
        };

        try {
            var response = await fetch("/api/bookings/create-checkout-session", {
                method:      "POST",
                headers:     {"Content-Type": "application/json"},

                // include session cookie so @fn_login_required sees the user
                credentials: "same-origin",
                body:        JSON.stringify(payload),
            });
            var data = await response.json();

            if (data.success && data.data && data.data.checkout_url) {
                // hand off to Stripe; saved state lets a cancel/back-out return them here to retry
                window.location.href = data.data.checkout_url;
            } else {
                fnShowError((data && data.error) || "Something went wrong. Please try again.");
                fnResetButton();
            }
        } catch (networkErr) {
            fnShowError("Network error. Please try again.");
            fnResetButton();
        }
    }

    // wires up the inline login form shown on step 3
    function fnSetupBookingLoginForm() {
        var form    = document.getElementById("booking-login-form");
        var errorEl = document.getElementById("booking-login-error");
        if (!form) { return; }

        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            if (errorEl) { errorEl.classList.add("hidden"); }

            var emailInput    = document.getElementById("bl-email");
            var passwordInput = document.getElementById("bl-password");
            var email         = emailInput    ? emailInput.value.trim() : "";
            var password      = passwordInput ? passwordInput.value     : "";

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

    // hides every step container, then unhides the one we want
    function fnShowStep(stepId) {
        var ids = ["step-1","step-2","step-3","step-4"];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (!el) { continue; }
            el.classList.add("hidden");
        }
        var target = document.getElementById("step-" + stepId);
        if (target) { target.classList.remove("hidden"); }
    }

    // central function that paints the correct step + stepper + nav buttons
    function fnRenderStep() {
        var s = bookingState.step;

        fnShowStep(s);
        fnUpdateStepper();

        // every visible step change is persisted so we survive reloads
        fnSaveState();

        var backBtn    = document.getElementById("btn-back");
        var proceedBtn = document.getElementById("btn-proceed");
        var navEl      = document.getElementById("step-nav");

        if (s === 1) {
            if (backBtn)    { backBtn.classList.add("hidden"); }
            if (proceedBtn) {
                proceedBtn.classList.remove("hidden");
                proceedBtn.innerHTML = 'Proceed <img src="/static/img/right.svg" alt="" class="w-4 h-4 invert">';
            }
            fnUpdateStep1UI();

        } else if (s === 2) {
            if (backBtn)    { backBtn.classList.remove("hidden"); }
            if (proceedBtn) {
                proceedBtn.classList.remove("hidden");
                proceedBtn.innerHTML = 'Proceed <img src="/static/img/right.svg" alt="" class="w-4 h-4 invert">';
            }
            fnInitStep2();
            fnUpdateProceedButton();

        } else if (s === 3) {
            if (backBtn)    { backBtn.classList.remove("hidden"); }
            if (proceedBtn) { proceedBtn.classList.add("hidden"); }

        } else if (s === 4) {
            if (navEl)      { navEl.classList.remove("hidden"); }
            if (backBtn)    { backBtn.classList.remove("hidden"); }
            if (proceedBtn) {
                proceedBtn.classList.remove("hidden");
                proceedBtn.disabled  = false;
                proceedBtn.innerHTML = 'Proceed to Payment <img src="/static/img/right.svg" alt="" class="w-4 h-4 invert">';
            }
            fnUpdateSummary();
        }
    }

    // proceed button handler
    function fnProceed() {
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

        } else if (s === 3) {
            // step 3 has no "proceed" - it is the inline login form

        } else if (s === 4) {
            // create the pending booking and hand off to Stripe
            fnStartCheckout();
        }
    }

    // back button handler
    function fnGoBack() {
        var s = bookingState.step;
        if (s === 2)      { bookingState.step = 1; }
        else if (s === 3) { bookingState.step = 2; }
        else if (s === 4) { bookingState.step = 2; }
        fnRenderStep();
    }

    // binds all the click handlers in one place
    function fnAttachEventListeners() {
        var adultDec   = document.getElementById("adult-dec");
        var adultInc   = document.getElementById("adult-inc");
        var juniorDec  = document.getElementById("junior-dec");
        var juniorInc  = document.getElementById("junior-inc");
        var extraDec   = document.getElementById("extra-dec");
        var extraInc   = document.getElementById("extra-inc");
        var backBtn    = document.getElementById("btn-back");
        var proceedBtn = document.getElementById("btn-proceed");

        // driver +/- buttons
        if (adultDec)  { adultDec.addEventListener("click",  function () { if (bookingState.adultCount > 0)  { bookingState.adultCount--;  fnUpdateStep1UI(); fnSaveState(); } }); }
        if (adultInc)  { adultInc.addEventListener("click",  function () { bookingState.adultCount++;  fnUpdateStep1UI(); fnSaveState(); }); }
        if (juniorDec) { juniorDec.addEventListener("click", function () { if (bookingState.juniorCount > 0) { bookingState.juniorCount--; fnUpdateStep1UI(); fnSaveState(); } }); }
        if (juniorInc) { juniorInc.addEventListener("click", function () { bookingState.juniorCount++; fnUpdateStep1UI(); fnSaveState(); }); }

        // extra rides +/-
        if (extraDec) { extraDec.addEventListener("click", function () { if (bookingState.extraRides > 1) { bookingState.extraRides--; fnUpdateStep1UI(); fnSaveState(); } }); }
        if (extraInc) { extraInc.addEventListener("click", function () { bookingState.extraRides++; fnUpdateStep1UI(); fnSaveState(); }); }

        // package cards - clicking anywhere on the card selects that package
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

        // wires up the inline step-3 login form
        fnSetupBookingLoginForm();
    }

    function fnInit() {
        // restore previous progress (if any) from localStorage
        fnLoadState();

        // logged in mid-flow? skip the inline login step
        if (bookingState.step === 3 && BOOKING_IS_LOGGED_IN) {
            bookingState.step = 4;
        }

        // any stale step from the old 5-step flow resets to a clean start
        if (bookingState.step > 4 || bookingState.step < 1) {
            fnClearState();
        }

        fnAttachEventListeners();
        fnRenderStep();
    }

    document.addEventListener("DOMContentLoaded", fnInit);
})();
