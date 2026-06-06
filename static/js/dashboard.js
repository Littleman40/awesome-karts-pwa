// drives the logged-in user dashboard at /dashboard
(function () {

    // strict mode, which gives errors for undeclared variables and other bad practices
    "use strict";

    // stores which user or minor needs to sign the waiver when the modal is open
    var waiverTarget = null;



    // sends a get request and returns the parsed json, or an error object if the request fails
    async function fnGetJSON(url) {
        try {
            // same-origin so the session cookie travels with the request
            var response = await fetch(url, {credentials: "same-origin"});
            return await response.json();
        } catch (e) {
            return {success: false, error: "Network error"};
        }
    }



    // simple POST with an empty JSON body
    async function fnPostJSON(url) {
        try {
            var response = await fetch(url, {
                method:      "POST",
                headers:     {"Content-Type": "application/json"},
                credentials: "same-origin",
                body:        JSON.stringify({}),
            });
            return await response.json();
        } catch (e) {
            return {success: false, error: "Network error"};
        }
    }



    // used for DELETE /api/users/me/minors/<id> and DELETE /api/users/me
    async function fnDeleteJSON(url) {
        try {
            var response = await fetch(url, {
                method:      "DELETE",
                credentials: "same-origin",
            });
            return await response.json();
        } catch (e) {
            return {success: false, error: "Network error"};
        }
    }



    // takes a date string and time label and returns a readable string like "Sunday 24 May, 2:00 PM"
    function fnFormatDateDisplay(dateString, timeLabel) {
        if (!dateString) { return ""; }

        // splits the date string into parts and builds a js date object
        var parts = dateString.split("-");
        var d      = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()] + ", " + timeLabel;
    }



    // formats a number of cents as a dollar amount string
    function fnFormatCents(cents) {
        return "$" + (cents / 100).toFixed(2);
    }



    // returns the coloured pill HTML for the booking's payment status
    function fnStatusBadgeHTML(booking) {
        var paymentStatus = booking.payment_status;

        // cancelled bookings get a red pill
        if (paymentStatus === "cancelled") {
            return '<span class="text-xs font-semibold bg-red-500 bg-opacity-20 text-red-400 px-2 py-0.5 rounded-full">Cancelled</span>';
        }

        // refunded bookings get a blue pill
        if (paymentStatus === "refunded") {
            return '<span class="text-xs font-semibold bg-blue-500 bg-opacity-20 text-blue-400 px-2 py-0.5 rounded-full">Refunded</span>';
        }

        if (paymentStatus === "paid") {
            // a paid booking whose date has passed is a finished session, not an upcoming one
            if (booking.is_past) {
                return '<span class="text-xs font-semibold bg-ak-border text-ak-muted px-2 py-0.5 rounded-full">Completed</span>';
            }
            return '<span class="text-xs font-semibold bg-green-500 bg-opacity-20 text-green-400 px-2 py-0.5 rounded-full">Upcoming</span>';
        }

        // default = pending (while Stripe confirms payment)
        return '<span class="text-xs font-semibold bg-yellow-500 bg-opacity-20 text-yellow-400 px-2 py-0.5 rounded-full">Pending</span>';
    }



    // builds one booking card DOM element; allowShareLink controls whether the creator's "Copy share link" button is shown
    function fnBuildBookingCard(booking, allowShareLink) {
        var dateLabel  = fnFormatDateDisplay(booking.date, booking.time_label);

        // builds a human readable string showing adult and junior counts
        var driversStr = "";
        if (booking.adult_count > 0)  { driversStr += booking.adult_count + " adult" + (booking.adult_count > 1 ? "s" : ""); }
        if (booking.junior_count > 0) {
            if (driversStr) { driversStr += ", "; }
            driversStr += booking.junior_count + " junior" + (booking.junior_count > 1 ? "s" : "");
        }

        // shows a purple "Created by you" badge or a grey "Shared with you" badge
        var ownerBadge = booking.is_creator
            ? '<span class="text-xs font-semibold bg-ak-purple bg-opacity-20 text-ak-purple px-2 py-0.5 rounded-full">Created by you</span>'
            : '<span class="text-xs font-semibold bg-ak-border text-ak-muted px-2 py-0.5 rounded-full">Shared with you</span>';

        var shareBtn = "";
        if (allowShareLink && booking.is_creator && booking.share_token) {
            // sharing is only offered for active bookings the user created - cancelled/refunded/past bookings can't be joined
            shareBtn = '<button type="button" class="copy-share-btn text-ak-muted hover:text-white text-xs underline transition-colors" data-token="' + booking.share_token + '">Copy share link</button>';
        }

        // creates the card element and fills it with booking details
        var card = document.createElement("div");
        card.className = "bg-ak-card border border-ak-border rounded-xl p-5 cursor-pointer hover:border-ak-purple transition-colors";
        card.innerHTML =
            '<div class="flex justify-between items-start gap-4">' +
                '<div>' +
                    '<p class="text-white font-bold">' + dateLabel + '</p>' +
                    '<p class="text-ak-muted text-sm mt-0.5">' + driversStr + '</p>' +
                    '<p class="text-ak-muted text-sm">' + booking.package_label + ' &nbsp;·&nbsp; ' + fnFormatCents(booking.total_amount) + '</p>' +
                '</div>' +
                '<div class="text-right shrink-0">' +
                    fnStatusBadgeHTML(booking) +
                    '<p class="text-ak-hint text-xs mt-1 font-mono">Ref: ' + booking.ref + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="mt-3 flex items-center justify-between gap-3">' +
                '<div class="flex items-center gap-3">' + ownerBadge + shareBtn + '</div>' +
                '<span class="text-ak-purple text-xs font-medium">View details →</span>' +
            '</div>';

        // whole card is clickable - opens the detail modal
        card.addEventListener("click", function () { fnOpenBookingModal(booking.id); });
        return card;
    }



    // attaches click-to-copy behaviour to every "Copy share link" button inside listEl
    function fnWireCopyShareButtons(listEl) {
        var copyBtns = listEl.querySelectorAll(".copy-share-btn");
        for (var buttonIndex = 0; buttonIndex < copyBtns.length; buttonIndex++) {

            // uses an immediately invoked function to capture the correct button reference in each loop iteration
            (function (copyButton) {
                copyButton.addEventListener("click", function (e) {
                    // don't let the click bubble up and open the detail modal
                    e.stopPropagation();
                    var token = copyButton.getAttribute("data-token");
                    if (!token) { return; }

                    // full URL so it's pasteable directly
                    var url = window.location.origin + "/bookings/share/" + token;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(url).then(function () {
                            copyButton.textContent = "Copied!";

                            // revert label after 2 seconds
                            setTimeout(function () { copyButton.textContent = "Copy share link"; }, 2000);
                        }).catch(function () { fnFallbackCopy(url, copyButton); });
                    } else {
                        fnFallbackCopy(url, copyButton);
                    }
                });
            }(copyBtns[buttonIndex]));
        }
    }



    // px - shows 1.5 cards
    var PAST_PEEK_HEIGHT = 238;



    // paints the Your Upcoming Bookings section
    function fnRenderBookings(upcomingBookings) {
        var loadingEl   = document.getElementById("bookings-loading");
        var emptyEl     = document.getElementById("bookings-empty");
        var wrapperEl   = document.getElementById("bookings-list-wrapper");
        var innerEl     = document.getElementById("bookings-list-inner");
        var listEl      = document.getElementById("bookings-list");
        var gradientEl  = document.getElementById("bookings-list-gradient");
        var showMoreRow = document.getElementById("bookings-show-more-row");
        var showMoreBtn = document.getElementById("btn-show-more-upcoming");

        // always hide the spinner once were rendering
        if (loadingEl) { loadingEl.classList.add("hidden"); }

        // no upcoming bookings - show the "Book Now" empty state
        if (!upcomingBookings || upcomingBookings.length === 0) {
            if (emptyEl)   { emptyEl.classList.remove("hidden"); }
            if (wrapperEl) { wrapperEl.classList.add("hidden"); }
            return;
        }

        if (!listEl) { return; }
        if (emptyEl)   { emptyEl.classList.add("hidden"); }
        if (wrapperEl) { wrapperEl.classList.remove("hidden"); }

        // clear any previously-rendered cards before re-rendering
        listEl.innerHTML = "";

        for (var bookingIndex = 0; bookingIndex < upcomingBookings.length; bookingIndex++) {
            // true = upcoming bookings can be shared
            listEl.appendChild(fnBuildBookingCard(upcomingBookings[bookingIndex], true));
        }

        fnWireCopyShareButtons(listEl);

        // truncate to ~1.5 cards when there are multiple upcoming bookings
        if (upcomingBookings.length > 1 && innerEl && showMoreRow && showMoreBtn) {
            innerEl.style.maxHeight = PAST_PEEK_HEIGHT + "px";
            if (gradientEl) { gradientEl.classList.remove("hidden"); }
            showMoreRow.classList.remove("hidden");

            var isExpanded = false;
            showMoreBtn.onclick = function () {
                isExpanded = !isExpanded;
                if (isExpanded) {

                    // expand to full content height
                    innerEl.style.maxHeight = innerEl.scrollHeight + "px";
                    if (gradientEl) { gradientEl.classList.add("hidden"); }
                    showMoreBtn.textContent = "Show less";
                } else {

                    // collapse back to the peek height
                    innerEl.style.maxHeight = PAST_PEEK_HEIGHT + "px";
                    if (gradientEl) { gradientEl.classList.remove("hidden"); }
                    showMoreBtn.textContent = "Show more";
                }
            };
        } else {
            // single booking - no clipping needed
            if (innerEl)     { innerEl.style.maxHeight = ""; }
            if (gradientEl)  { gradientEl.classList.add("hidden"); }
            if (showMoreRow) { showMoreRow.classList.add("hidden"); }
        }
    }



    // paints the Past & Cancelled Bookings section - hidden entirely when there's nothing to show
    function fnRenderPastBookings(pastBookings) {
        var sectionEl   = document.getElementById("past-bookings-section");
        var listEl      = document.getElementById("past-bookings-list");
        var innerEl     = document.getElementById("past-bookings-inner");
        var gradientEl  = document.getElementById("past-bookings-gradient");
        var showMoreRow = document.getElementById("past-bookings-show-more-row");
        var showMoreBtn = document.getElementById("btn-show-more-past");
        if (!sectionEl || !listEl) { return; }

        // if there are no past bookings, hide the entire section
        if (!pastBookings || pastBookings.length === 0) {
            sectionEl.classList.add("hidden");
            return;
        }

        listEl.innerHTML = "";
        for (var bookingIndex = 0; bookingIndex < pastBookings.length; bookingIndex++) {
            // false = no share link on finished/cancelled/refunded bookings
            listEl.appendChild(fnBuildBookingCard(pastBookings[bookingIndex], false));
        }
        sectionEl.classList.remove("hidden");

        // truncate to ~1.5 cards when there are multiple past bookings
        if (pastBookings.length > 1 && innerEl && showMoreRow && showMoreBtn) {
            innerEl.style.maxHeight = PAST_PEEK_HEIGHT + "px";
            if (gradientEl) { gradientEl.classList.remove("hidden"); }
            showMoreRow.classList.remove("hidden");

            var isExpanded = false;
            showMoreBtn.onclick = function () {
                isExpanded = !isExpanded;
                if (isExpanded) {
                    // expand to full content height
                    innerEl.style.maxHeight = innerEl.scrollHeight + "px";
                    if (gradientEl) { gradientEl.classList.add("hidden"); }
                    showMoreBtn.textContent = "Show less";
                } else {

                    // collapse back to the peek height
                    innerEl.style.maxHeight = PAST_PEEK_HEIGHT + "px";
                    if (gradientEl) { gradientEl.classList.remove("hidden"); }
                    showMoreBtn.textContent = "Show more";
                }
            };
        } else {
            // single booking - no clipping needed
            if (innerEl)     { innerEl.style.maxHeight = ""; }
            if (gradientEl)  { gradientEl.classList.add("hidden"); }
            if (showMoreRow) { showMoreRow.classList.add("hidden"); }
        }
    }



    // copies text to clipboard using the old textarea trick for browsers without the clipboard api
    function fnFallbackCopy(text, btn) {

        // creates a hidden textarea, selects its content, and runs the copy command
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity  = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand("copy");

            // if a button was passed in, temporarily change its label to "Copied!"
            if (btn) {
                btn.textContent = "Copied!";
                setTimeout(function () { btn.textContent = "Copy share link"; }, 2000);
            }
        } catch (e) {}
        document.body.removeChild(ta);
    }



    // payment-specific badge for the detail modal (distinct from the card's Upcoming/Completed badge)
    function fnPaymentBadgeHTML(status) {
        if (status === "paid")      { return '<span class="text-xs font-semibold bg-green-500 bg-opacity-20 text-green-400 px-2 py-0.5 rounded-full">Paid</span>'; }
        if (status === "pending")   { return '<span class="text-xs font-semibold bg-yellow-500 bg-opacity-20 text-yellow-400 px-2 py-0.5 rounded-full">Pending</span>'; }
        if (status === "cancelled") { return '<span class="text-xs font-semibold bg-red-500 bg-opacity-20 text-red-400 px-2 py-0.5 rounded-full">Cancelled</span>'; }
        if (status === "refunded")  { return '<span class="text-xs font-semibold bg-blue-500 bg-opacity-20 text-blue-400 px-2 py-0.5 rounded-full">Refunded</span>'; }
        return '<span class="text-xs font-semibold bg-ak-border text-ak-muted px-2 py-0.5 rounded-full">' + status + '</span>';
    }



    // human explanation under the payment box, including the "we're waiting" state
    function fnPaymentNote(booking) {
        if (booking.payment_status === "paid") {
            return booking.paid_at ? ("Paid on " + new Date(booking.paid_at).toLocaleString("en-AU")) : "Payment confirmed.";
        }
        if (booking.payment_status === "pending") {
            return "We're waiting for your payment to be confirmed - this usually only takes a few seconds. If payment wasn't completed, this booking is released automatically.";
        }
        if (booking.payment_status === "cancelled") { return "This booking was cancelled and the spot was released."; }
        if (booking.payment_status === "refunded")  { return "This booking was refunded to your original payment method."; }
        return "";
    }



    // returns the package label string, including extra sessions for the 4+ package
    function fnPackageDetailString(booking) {
        if (booking.package_id === "4_plus") {
            return booking.package_label + " (" + (3 + (booking.extra_rides || 0)) + " sessions each)";
        }
        return booking.package_label;
    }



    // fills the detail modal from the /me/bookings/<id> payload
    function fnRenderBookingDetail(booking) {

        // shorthand helpers to set text or html content of an element by id
        var set     = function (id, value) { var el = document.getElementById(id); if (el) { el.textContent = value; } };
        var setHTML = function (id, html)  { var el = document.getElementById(id); if (el) { el.innerHTML  = html;  } };

        // fills in the basic booking fields
        set("bd-ref",      booking.ref || "");
        setHTML("bd-status", fnStatusBadgeHTML(booking));
        set("bd-datetime", fnFormatDateDisplay(booking.date, booking.time_label));

        // builds a driver count string like "2 adults, 1 junior"
        var driversStr = "";
        if (booking.adult_count > 0)  { driversStr += booking.adult_count + " adult" + (booking.adult_count > 1 ? "s" : ""); }
        if (booking.junior_count > 0) { if (driversStr) { driversStr += ", "; } driversStr += booking.junior_count + " junior" + (booking.junior_count > 1 ? "s" : ""); }
        set("bd-drivers", driversStr || ("" + booking.total_drivers));
        set("bd-package", fnPackageDetailString(booking));

        // finds the creator name from the attendees list
        var attendees   = booking.attendees || [];
        var creatorName = booking.is_creator ? "You" : "";
        for (var i = 0; i < attendees.length; i++) {
            if (attendees[i].is_creator) { creatorName = attendees[i].is_you ? "You" : attendees[i].name; }
        }
        set("bd-creator", creatorName || "-");

        // builds a row of coloured name pills for each attendee
        var pillsHTML = "";
        for (var j = 0; j < attendees.length; j++) {
            var a     = attendees[j];
            var label = a.name + (a.is_you ? " (you)" : "");
            var cls   = a.is_creator
                ? "text-xs font-medium bg-ak-purple bg-opacity-20 text-ak-purple px-2.5 py-1 rounded-full"
                : "text-xs font-medium bg-ak-border text-white px-2.5 py-1 rounded-full";
            pillsHTML += '<span class="' + cls + '">' + label + (a.is_creator ? " · organiser" : "") + '</span>';
        }
        setHTML("bd-attendees", pillsHTML || '<span class="text-ak-muted text-sm">Just you</span>');

        // fills in the payment section
        setHTML("bd-payment-badge", fnPaymentBadgeHTML(booking.payment_status));
        set("bd-amount",       fnFormatCents(booking.total_amount));
        set("bd-payment-note", fnPaymentNote(booking));

        // shows or hides the share link row depending on whether this booking can be shared
        var shareRow   = document.getElementById("bd-share-row");
        var shareInput = document.getElementById("bd-share-url");
        var canShare   = booking.is_creator && booking.share_token &&
                         booking.payment_status !== "cancelled" && booking.payment_status !== "refunded" && !booking.is_past;
        if (shareRow) {
            if (canShare) {
                shareRow.classList.remove("hidden");
                if (shareInput) { shareInput.value = window.location.origin + "/bookings/share/" + booking.share_token; }
            } else {
                shareRow.classList.add("hidden");
            }
        }
    }



    // opens the modal and fetches full detail (incl. attendees) for the given booking
    async function fnOpenBookingModal(bookingId) {
        var modal   = document.getElementById("booking-detail-modal");
        var loading = document.getElementById("bd-loading");
        var body    = document.getElementById("bd-body");
        if (!modal) { return; }

        // shows the loading spinner and hides the body while fetching
        if (loading) { loading.classList.remove("hidden"); }
        if (body)    { body.classList.add("hidden"); }
        modal.classList.remove("hidden");

        // fetches the booking detail from the server
        var result = await fnGetJSON("/api/users/me/bookings/" + encodeURIComponent(bookingId));
        if (result.success) {
            fnRenderBookingDetail(result.data);
            if (loading) { loading.classList.add("hidden"); }
            if (body)    { body.classList.remove("hidden"); }
        } else {

            // if the request failed, show the error message in the loading element
            if (loading) { loading.textContent = result.error || "Could not load booking details."; }
        }
    }



    // hides the booking detail modal
    function fnCloseBookingModal() {
        var modal = document.getElementById("booking-detail-modal");
        if (modal) { modal.classList.add("hidden"); }
    }



    // wires close button, backdrop click, and the copy-share button (done once on load)
    function fnSetupBookingDetailModal() {
        var modal      = document.getElementById("booking-detail-modal");
        var closeBtn   = document.getElementById("bd-close");
        var copyBtn    = document.getElementById("bd-copy-share");
        var shareInput = document.getElementById("bd-share-url");

        // close button hides the modal
        if (closeBtn) { closeBtn.addEventListener("click", fnCloseBookingModal); }
        if (modal) {
            // only close when the click was on the backdrop, not inside the modal content
            modal.addEventListener("click", function (e) { if (e.target === modal) { fnCloseBookingModal(); } });
        }

        // copy button copies the share url from the input field
        if (copyBtn && shareInput) {
            copyBtn.addEventListener("click", function () {
                var url = shareInput.value;
                if (!url) { return; }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(function () {
                        copyBtn.textContent = "Copied!";
                        setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
                    }).catch(function () { fnFallbackCopy(url, null); copyBtn.textContent = "Copied!"; setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000); });
                } else {
                    fnFallbackCopy(url, null);
                    copyBtn.textContent = "Copied!";
                    setTimeout(function () { copyBtn.textContent = "Copy"; }, 2000);
                }
            });
        }
    }



    // cached copy of the last-rendered minors list
    var minorsData = [];



    // paints the minor list (one card per child) and reveals the "+ Add a Minor" button
    function fnRenderMinors(minors) {
        minorsData = minors;
        var loadingEl = document.getElementById("minors-loading");
        var listEl    = document.getElementById("minors-list");
        var addBtn    = document.getElementById("btn-add-minor");

        // hides the loading spinner
        if (loadingEl) { loadingEl.classList.add("hidden"); }

        // only show the "Add a Minor" button after the initial load completes
        if (addBtn) { addBtn.classList.remove("hidden"); }

        if (!listEl) { return; }
        listEl.innerHTML = "";

        // if there are no minors, hide the list container
        if (!minors || minors.length === 0) {
            listEl.classList.add("hidden");
            return;
        }

        listEl.classList.remove("hidden");
        for (var i = 0; i < minors.length; i++) {
            var m = minors[i];

            // age was computed server-side in fn_format_minor_for_api
            var ageStr = m.age !== null ? "Age " + m.age : "";
            var card = document.createElement("div");
            card.className = "bg-ak-card border border-ak-border rounded-xl px-5 py-3.5 flex justify-between items-center";
            card.innerHTML =
                '<div>' +
                    '<p class="text-white font-semibold text-sm">' + m.first_name + " " + m.last_name + '</p>' +
                    '<p class="text-ak-muted text-xs">' + ageStr + '</p>' +
                '</div>' +
                '<button type="button" class="remove-minor-btn text-red-400 hover:text-red-300 text-xs font-medium transition-colors" data-id="' + m.id + '">Remove</button>';
            listEl.appendChild(card);
        }

        // wires up the remove button on each minor card
        var removeBtns = listEl.querySelectorAll(".remove-minor-btn");
        for (var j = 0; j < removeBtns.length; j++) {

            // uses an immediately invoked function to capture the correct button reference in each loop iteration
            (function (btn) {
                btn.addEventListener("click", async function () {
                    var minorId = btn.getAttribute("data-id");

                    // shows a loading state while waiting for the server
                    btn.textContent = "Removing…";
                    btn.disabled    = true;
                    var result = await fnDeleteJSON("/api/users/me/minors/" + minorId);
                    if (result.success) {
                        // reload everything so the minor disappears + waivers section updates too
                        fnLoadDashboard();
                    } else {
                        // re-enable on failure so the user can retry
                        btn.textContent = "Remove";
                        btn.disabled    = false;
                    }
                });
            }(removeBtns[j]));
        }
    }



    // wires up the toggle button, cancel button, and submit handler for the "Add a Minor" form
    function fnSetupAddMinorForm() {
        var addBtn    = document.getElementById("btn-add-minor");
        var wrapper   = document.getElementById("add-minor-form-wrapper");
        var cancelBtn = document.getElementById("btn-cancel-minor");
        var form      = document.getElementById("add-minor-form");
        var errorEl   = document.getElementById("add-minor-error");

        if (addBtn && wrapper) {
            // clicking "Add a Minor" toggles the form open/closed
            addBtn.addEventListener("click", function () {
                wrapper.classList.toggle("hidden");
            });
        }

        if (cancelBtn && wrapper) {
            cancelBtn.addEventListener("click", function () {
                wrapper.classList.add("hidden");

                // wipe form fields so its fresh next time
                if (form)    { form.reset(); }
                if (errorEl) { errorEl.classList.add("hidden"); }
            });
        }

        if (!form) { return; }

        // handles the add minor form submission
        form.addEventListener("submit", async function (e) {

            // stops page from reloading
            e.preventDefault();
            if (errorEl) { errorEl.classList.add("hidden"); }

            // collects the form values into a payload object
            var firstEl  = document.getElementById("minor-first");
            var lastEl   = document.getElementById("minor-last");
            var genderEl = document.getElementById("minor-gender");
            var dobEl    = document.getElementById("minor-dob");

            var payload = {
                first_name: firstEl  ? firstEl.value.trim()  : "",
                last_name:  lastEl   ? lastEl.value.trim()   : "",
                gender:     genderEl ? genderEl.value        : "",
                dob:        dobEl    ? dobEl.value           : "",
            };

            var submitBtn = form.querySelector("[type=submit]");

            // prevent double-submission while the request is in-flight
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Adding…"; }

            try {
                // sends the add minor request to the server
                var response = await fetch("/api/users/me/minors", {
                    method:      "POST",
                    headers:     {"Content-Type": "application/json"},
                    credentials: "same-origin",
                    body:        JSON.stringify(payload),
                });
                var data = await response.json();

                if (data.success) {
                    form.reset();
                    if (wrapper) { wrapper.classList.add("hidden"); }

                    // reload everything so the new minor appears in the list
                    fnLoadDashboard();
                } else {
                    var errMsg = "Something went wrong.";

                    // server-side validation message (eg "Minors must be at least 8 years old")
                    if (data.error) { errMsg = data.error; }
                    if (errorEl) { errorEl.textContent = errMsg; errorEl.classList.remove("hidden"); }
                }
            } catch (netErr) {
                if (errorEl) { errorEl.textContent = "Network error. Please try again."; errorEl.classList.remove("hidden"); }
            } finally {
                // re-enable button regardless of success/failure
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Minor"; }
            }
        });
    }



    // paints the Waivers section using the {user, minors} payload from the API
    function fnRenderWaivers(waiverData) {
        var loadingEl   = document.getElementById("waivers-loading");
        var containerEl = document.getElementById("waivers-container");

        // hides the loading spinner and clears the container before re-rendering
        if (loadingEl)    { loadingEl.classList.add("hidden"); }
        if (!containerEl) { return; }
        containerEl.innerHTML = "";
        containerEl.classList.remove("hidden");

        // builds the waiver row for the account holder (the adult user)
        var userWaiver  = waiverData.user;
        var userRow     = document.createElement("div");
        userRow.className = "flex justify-between items-center px-5 py-4";
        var userSignedAt = userWaiver.waiver_accepted_at
            ? '<span class="text-ak-hint text-xs mt-0.5 block">' + new Date(userWaiver.waiver_accepted_at).toLocaleDateString("en-AU") + '</span>'
            : "";

        // shows a green "Signed" label if already signed, or a "Sign now" button if not
        var userAction = userWaiver.waiver_accepted
            ? '<span class="text-green-400 text-sm font-medium flex items-center gap-1"><img src="/static/img/tick.svg" alt="" class="w-4 h-4 invert">Signed</span>'
            : '<button type="button" class="open-waiver-btn bg-ak-purple hover:bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors" data-type="user">Sign now</button>';
        userRow.innerHTML =
            '<div><p class="text-white text-sm font-medium">You</p>' + userSignedAt + '</div>' + userAction;
        containerEl.appendChild(userRow);

        // builds a waiver row for each registered minor
        var minors = waiverData.minors;
        if (minors) {
            for (var i = 0; i < minors.length; i++) {
                var m    = minors[i];
                var mRow = document.createElement("div");
                mRow.className = "flex justify-between items-center px-5 py-4";
                var mSignedAt = m.waiver_accepted_at
                    ? '<span class="text-ak-hint text-xs mt-0.5 block">' + new Date(m.waiver_accepted_at).toLocaleDateString("en-AU") + '</span>'
                    : "";

                // shows a signed label or a "Sign for [name]" button for each minor
                var mAction = m.waiver_accepted
                    ? '<span class="text-green-400 text-sm font-medium flex items-center gap-1"><img src="/static/img/tick.svg" alt="" class="w-4 h-4 invert">Signed</span>'
                    : '<button type="button" class="open-waiver-btn bg-ak-purple hover:bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors" data-type="minor" data-id="' + m.id + '" data-name="' + m.name + '">Sign for ' + m.name.split(" ")[0] + '</button>';
                mRow.innerHTML =
                    '<div><p class="text-white text-sm font-medium">' + m.name + '</p>' + mSignedAt + '</div>' + mAction;
                containerEl.appendChild(mRow);
            }
        }

        // wires up the sign now buttons to open the waiver modal for the right person
        var openBtns = containerEl.querySelectorAll(".open-waiver-btn");
        for (var j = 0; j < openBtns.length; j++) {
            (function (btn) {
                btn.addEventListener("click", function () {
                    var type = btn.getAttribute("data-type");

                    // opens the modal skinned for the user or for the specific minor
                    if (type === "user") {
                        fnOpenWaiverModal({type: "user"});
                    } else {
                        fnOpenWaiverModal({
                            type: "minor",
                            id:   btn.getAttribute("data-id"),
                            name: btn.getAttribute("data-name"),
                        });
                    }
                });
            }(openBtns[j]));
        }
    }



    // opens the shared waiver modal and skins it for the user or a specific minor
    function fnOpenWaiverModal(target) {

        // remember for the Sign button click handler
        waiverTarget = target;
        var modal      = document.getElementById("waiver-modal");
        var titleEl    = document.getElementById("waiver-modal-title");
        var noteEl     = document.getElementById("waiver-guardian-note");
        var agreeLabel = document.getElementById("waiver-agree-label");
        var checkbox   = document.getElementById("waiver-agree-checkbox");
        var errorEl    = document.getElementById("waiver-modal-error");

        // resets the checkbox and hides any previous error
        if (checkbox) { checkbox.checked = false; }
        if (errorEl)  { errorEl.classList.add("hidden"); }

        var signBtn = document.getElementById("btn-sign-waiver");

        // reset the label too - a previous successful sign leaves it on "Signing…" because the
        // success path closes the modal without restoring the button text
        if (signBtn) { signBtn.disabled = true; signBtn.textContent = "Sign"; }

        // customises the modal title and labels depending on whether it is for the user or a minor
        if (target.type === "minor") {
            if (titleEl)    { titleEl.textContent = "Sign Waiver for " + target.name; }
            if (noteEl)     {
                noteEl.textContent = "I am the parent or legal guardian of " + target.name + " and accept this waiver on their behalf.";
                noteEl.classList.remove("hidden");
            }
            if (agreeLabel) { agreeLabel.textContent = "I have read and agree to the terms of this waiver on behalf of " + target.name + "."; }
        } else {
            if (titleEl)    { titleEl.textContent = "Sign Your Waiver"; }
            if (noteEl)     { noteEl.classList.add("hidden"); }
            if (agreeLabel) { agreeLabel.textContent = "I have read and agree to the terms of this waiver."; }
        }

        // shows the modal
        if (modal) { modal.classList.remove("hidden"); }
    }



    // clears the target and hides the modal
    function fnCloseWaiverModal() {
        waiverTarget = null;
        var modal = document.getElementById("waiver-modal");
        if (modal) { modal.classList.add("hidden"); }
    }



    // wires the modal's checkbox, sign button, cancel button, and backdrop click
    function fnSetupWaiverModal() {
        var checkbox  = document.getElementById("waiver-agree-checkbox");
        var signBtn   = document.getElementById("btn-sign-waiver");
        var cancelBtn = document.getElementById("btn-cancel-waiver");
        var errorEl   = document.getElementById("waiver-modal-error");

        // Sign button is disabled until the agreement checkbox is ticked
        if (checkbox && signBtn) {
            checkbox.addEventListener("change", function () {
                signBtn.disabled = !checkbox.checked;
            });
        }

        // cancel button just closes the modal
        if (cancelBtn) {
            cancelBtn.addEventListener("click", fnCloseWaiverModal);
        }

        if (signBtn) {
            signBtn.addEventListener("click", async function () {

                // nothing to sign if waiverTarget is not set
                if (!waiverTarget) { return; }
                signBtn.disabled    = true;
                signBtn.textContent = "Signing…";
                if (errorEl) { errorEl.classList.add("hidden"); }

                // picks the right endpoint depending on whether it is a user or minor waiver
                var url = "/api/users/me/waiver/sign";
                if (waiverTarget.type === "minor") {
                    url = "/api/users/me/minors/" + waiverTarget.id + "/waiver/sign";
                }

                // sends the sign request to the server
                var result = await fnPostJSON(url);
                if (result.success) {
                    fnCloseWaiverModal();

                    // reload so the row swaps from "Sign now" to "Signed"
                    fnLoadDashboard();
                } else {
                    var errMsg = "Something went wrong.";
                    if (result.error) { errMsg = result.error; }
                    if (errorEl) { errorEl.textContent = errMsg; errorEl.classList.remove("hidden"); }
                    signBtn.disabled    = false;
                    signBtn.textContent = "Sign";
                }
            });
        }

        var modal = document.getElementById("waiver-modal");
        if (modal) {
            // only close when the click was on the backdrop, not inside the modal content
            modal.addEventListener("click", function (e) {
                if (e.target === modal) { fnCloseWaiverModal(); }
            });
        }
    }



    // fetches all 3 sections in parallel - saves time vs serial requests
    async function fnLoadDashboard() {
        var results = await Promise.all([
            fnGetJSON("/api/users/me/bookings"),
            fnGetJSON("/api/users/me/minors"),
            fnGetJSON("/api/users/me/waiver-status"),
        ]);

        // renders each section if its request succeeded
        if (results[0].success) {
            fnRenderBookings(results[0].data.upcoming);
            fnRenderPastBookings(results[0].data.past);
        }
        if (results[1].success) { fnRenderMinors(results[1].data); }
        if (results[2].success) { fnRenderWaivers(results[2].data); }
    }



    // wires up the danger-zone "Delete Account" flow: open modal -> tick checkbox -> confirm -> DELETE /api/users/me
    function fnSetupDeleteAccount() {
        var openBtn    = document.getElementById("btn-delete-account");
        var modal      = document.getElementById("delete-account-modal");
        var checkbox   = document.getElementById("delete-account-confirm-checkbox");
        var confirmBtn = document.getElementById("btn-confirm-delete-account");
        var cancelBtn  = document.getElementById("btn-cancel-delete-account");
        var errorEl    = document.getElementById("delete-account-error");

        // reset modal state every time it closes so reopening is clean
        function fnCloseDeleteModal() {
            if (modal)    { modal.classList.add("hidden"); }
            if (checkbox) { checkbox.checked = false; }
            if (confirmBtn) {
                confirmBtn.disabled    = true;
                confirmBtn.textContent = "Delete My Account";
            }
            if (errorEl) { errorEl.classList.add("hidden"); errorEl.textContent = ""; }
        }

        if (openBtn && modal) {
            openBtn.addEventListener("click", function () {
                // always force the user to re-tick the acknowledgement each time they open the modal
                if (checkbox)   { checkbox.checked = false; }
                if (confirmBtn) { confirmBtn.disabled = true; }
                if (errorEl)    { errorEl.classList.add("hidden"); }
                modal.classList.remove("hidden");
            });
        }

        // cancel button resets and closes the modal
        if (cancelBtn) {
            cancelBtn.addEventListener("click", fnCloseDeleteModal);
        }

        if (modal) {
            // backdrop click closes - same pattern as the waiver modal
            modal.addEventListener("click", function (e) {
                if (e.target === modal) { fnCloseDeleteModal(); }
            });
        }

        if (checkbox && confirmBtn) {
            // confirm button stays disabled until the acknowledgement checkbox is ticked
            checkbox.addEventListener("change", function () {
                confirmBtn.disabled = !checkbox.checked;
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener("click", async function () {

                // belt-and-braces: the button should already be disabled, but double-check
                if (!checkbox || !checkbox.checked) { return; }
                confirmBtn.disabled    = true;
                confirmBtn.textContent = "Deleting…";
                if (errorEl) { errorEl.classList.add("hidden"); }

                // sends the delete account request to the server
                var result = await fnDeleteJSON("/api/users/me");
                if (result.success) {

                    // server sends "/" but fall back just in case
                    var redirectUrl = "/";
                    if (result.data && result.data.redirect) { redirectUrl = result.data.redirect; }
                    window.location.href = redirectUrl;
                } else {
                    var errMsg = "Something went wrong. Please try again.";
                    if (result.error) { errMsg = result.error; }
                    if (errorEl) { errorEl.textContent = errMsg; errorEl.classList.remove("hidden"); }
                    confirmBtn.disabled    = false;
                    confirmBtn.textContent = "Delete My Account";
                }
            });
        }
    }



    // entry point - runs on DOMContentLoaded
    function fnInit() {

        // wires up the add/remove minor form
        fnSetupAddMinorForm();

        // wires up the waiver modal once (its content gets re-skinned each time it opens)
        fnSetupWaiverModal();

        // wires up the danger-zone Delete Account button + confirmation modal
        fnSetupDeleteAccount();

        // wires up the click-to-expand booking detail modal
        fnSetupBookingDetailModal();

        // initial data fetch + render
        fnLoadDashboard();
    }

    document.addEventListener("DOMContentLoaded", fnInit);
})();
