// dashboard.js - drives the logged-in user dashboard at /dashboard
(function () {
    "use strict";                                                                                               // physically a strict rule for javascript

    var waiverTarget = null;

    async function fnGetJSON(url) {
        try {
            var response = await fetch(url, {credentials: "same-origin"});                                      // same-origin so the session cookie travels with the request
            return await response.json();
        } catch (e) {
            return {success: false, error: "Network error"};
        }
    }

    async function fnPostJSON(url) {                                                                            // simple POST with an empty JSON body
        try {
            var response = await fetch(url, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "same-origin",
                body: JSON.stringify({}),
            });
            return await response.json();
        } catch (e) {
            return {success: false, error: "Network error"};
        }
    }

    async function fnDeleteJSON(url) {                                                                          // used for DELETE /api/users/me/minors/<id>
        try {
            var response = await fetch(url, {
                method: "DELETE",
                credentials: "same-origin",
            });
            return await response.json();
        } catch (e) {
            return {success: false, error: "Network error"};
        }
    }

    function fnFormatDateDisplay(dateString, timeLabel) {
        if (!dateString) { return ""; }
        var parts = dateString.split("-");
        var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()] + ", " + timeLabel;
    }

    function fnFormatCents(cents) {
        return "$" + (cents / 100).toFixed(2);
    }

    function fnStatusBadgeHTML(paymentStatus) {                                                                 // returns the colored pill HTML for the booking's payment status
        if (paymentStatus === "paid") {
            return '<span class="text-xs font-semibold bg-green-500 bg-opacity-20 text-green-400 px-2 py-0.5 rounded-full">Upcoming</span>';
        }
        if (paymentStatus === "cancelled") {
            return '<span class="text-xs font-semibold bg-red-500 bg-opacity-20 text-red-400 px-2 py-0.5 rounded-full">Cancelled</span>';
        }
        if (paymentStatus === "refunded") {
            return '<span class="text-xs font-semibold bg-ak-border text-ak-muted px-2 py-0.5 rounded-full">Refunded</span>';
        }
        return '<span class="text-xs font-semibold bg-yellow-500 bg-opacity-20 text-yellow-400 px-2 py-0.5 rounded-full">Pending</span>';   // default = pending (v3 will use this once Stripe is wired up)
    }


    function fnRenderBookings(bookings) {                                                                       // paints the "Upcoming Bookings" section from the API response
        var loadingEl = document.getElementById("bookings-loading");
        var emptyEl   = document.getElementById("bookings-empty");
        var listEl    = document.getElementById("bookings-list");

        if (loadingEl) { loadingEl.classList.add("hidden"); }                                                   // always hide the spinner once we're rendering

        if (!bookings || bookings.length === 0) {                                                               // no bookings, show the "Book Now" empty state
            if (emptyEl) { emptyEl.classList.remove("hidden"); }
            return;
        }

        if (!listEl) { return; }
        listEl.innerHTML = "";                                                                                  // clear any previously-rendered cards before re-rendering
        listEl.classList.remove("hidden");

        for (var i = 0; i < bookings.length; i++) {
            var b = bookings[i];
            var dateLabel = fnFormatDateDisplay(b.date, b.time_label);

            var driversStr = "";
            if (b.adult_count > 0)  { driversStr += b.adult_count + " adult" + (b.adult_count > 1 ? "s" : ""); }
            if (b.junior_count > 0) {
                if (driversStr) { driversStr += ", "; }
                driversStr += b.junior_count + " junior" + (b.junior_count > 1 ? "s" : "");
            }

            var ownerBadge = b.is_creator
                ? '<span class="text-xs font-semibold bg-ak-purple bg-opacity-20 text-ak-purple px-2 py-0.5 rounded-full">Created by you</span>'
                : '<span class="text-xs font-semibold bg-ak-border text-ak-muted px-2 py-0.5 rounded-full">Shared with you</span>';

            var shareBtn = "";
            if (b.is_creator && b.share_token) {
                shareBtn = '<button type="button" class="copy-share-btn text-ak-muted hover:text-white text-xs underline transition-colors" data-token="' + b.share_token + '">Copy share link</button>';
            }

            var card = document.createElement("div");
            card.className = "bg-ak-card border border-ak-border rounded-xl p-5";
            card.innerHTML =
                '<div class="flex justify-between items-start gap-4">' +
                    '<div>' +
                        '<p class="text-white font-bold">' + dateLabel + '</p>' +
                        '<p class="text-ak-muted text-sm mt-0.5">' + driversStr + '</p>' +
                        '<p class="text-ak-muted text-sm">' + b.package_label + ' &nbsp;·&nbsp; ' + fnFormatCents(b.total_amount) + '</p>' +
                    '</div>' +
                    '<div class="text-right shrink-0">' +
                        fnStatusBadgeHTML(b.payment_status) +
                        '<p class="text-ak-hint text-xs mt-1 font-mono">Ref: ' + b.ref + '</p>' +
                    '</div>' +
                '</div>' +
                '<div class="mt-3 flex items-center gap-3">' +
                    ownerBadge + shareBtn +
                '</div>';

            listEl.appendChild(card);
        }

        var copyBtns = listEl.querySelectorAll(".copy-share-btn");
        for (var j = 0; j < copyBtns.length; j++) {
            (function (btn) {
                btn.addEventListener("click", function () {
                    var token = btn.getAttribute("data-token");
                    if (!token) { return; }
                    var url = window.location.origin + "/bookings/share/" + token;                              // full URL so it's pasteable directly
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(url).then(function () {
                            btn.textContent = "Copied!";
                            setTimeout(function () { btn.textContent = "Copy share link"; }, 2000);             // revert label after 2 seconds
                        }).catch(function () { fnFallbackCopy(url, btn); });
                    } else {
                        fnFallbackCopy(url, btn);
                    }
                });
            }(copyBtns[j]));
        }
    }

    function fnFallbackCopy(text, btn) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand("copy");
            if (btn) {
                btn.textContent = "Copied!";
                setTimeout(function () { btn.textContent = "Copy share link"; }, 2000);
            }
        } catch (e) {}
        document.body.removeChild(ta);
    }

    var minorsData = [];                                                                                        // cached copy of the last-rendered minors

    function fnRenderMinors(minors) {                                                                           // paints the minor list (one card per child) and reveals the "+ Add a Minor" button
        minorsData = minors;
        var loadingEl = document.getElementById("minors-loading");
        var listEl    = document.getElementById("minors-list");
        var addBtn    = document.getElementById("btn-add-minor");

        if (loadingEl) { loadingEl.classList.add("hidden"); }
        if (addBtn)    { addBtn.classList.remove("hidden"); }                                                   // only show the "Add a Minor" button after the initial load completes

        if (!listEl) { return; }
        listEl.innerHTML = "";

        if (!minors || minors.length === 0) {
            listEl.classList.add("hidden");                                                                     // no minors yet
            return;
        }

        listEl.classList.remove("hidden");
        for (var i = 0; i < minors.length; i++) {
            var m = minors[i];
            var ageStr = m.age !== null ? "Age " + m.age : "";                                                  // age was computed server-side in fn_format_minor_for_api
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

        var removeBtns = listEl.querySelectorAll(".remove-minor-btn");
        for (var j = 0; j < removeBtns.length; j++) {
            (function (btn) {
                btn.addEventListener("click", async function () {
                    var minorId = btn.getAttribute("data-id");
                    btn.textContent = "Removing…";
                    btn.disabled = true;
                    var result = await fnDeleteJSON("/api/users/me/minors/" + minorId);
                    if (result.success) {
                        fnLoadDashboard();                                                                      // reload everything so the minor disappears + the waivers section updates too
                    } else {
                        btn.textContent = "Remove";                                                             // re-enable on failure so the user can retry
                        btn.disabled = false;
                    }
                });
            }(removeBtns[j]));
        }
    }

    function fnSetupAddMinorForm() {                                                                            // wires up the toggle button, cancel button, and submit handler for the "Add a Minor" form
        var addBtn      = document.getElementById("btn-add-minor");
        var wrapper     = document.getElementById("add-minor-form-wrapper");
        var cancelBtn   = document.getElementById("btn-cancel-minor");
        var form        = document.getElementById("add-minor-form");
        var errorEl     = document.getElementById("add-minor-error");

        if (addBtn && wrapper) {
            addBtn.addEventListener("click", function () {                                                      // clicking "Add a Minor" toggles the form open/closed
                wrapper.classList.toggle("hidden");
            });
        }

        if (cancelBtn && wrapper) {
            cancelBtn.addEventListener("click", function () {
                wrapper.classList.add("hidden");
                if (form) { form.reset(); }                                                                     // wipe form fields so its fresh next time
                if (errorEl) { errorEl.classList.add("hidden"); }
            });
        }

        if (!form) { return; }

        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            if (errorEl) { errorEl.classList.add("hidden"); }

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
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Adding…"; }                    // prevent double-submission while the request is in-flight

            try {
                var response = await fetch("/api/users/me/minors", {
                    method:  "POST",
                    headers: {"Content-Type": "application/json"},
                    credentials: "same-origin",
                    body: JSON.stringify(payload),
                });
                var data = await response.json();

                if (data.success) {
                    form.reset();                                                                               // clear the form
                    if (wrapper) { wrapper.classList.add("hidden"); }                                           // close the form
                    fnLoadDashboard();                                                                          // reload everythin
                } else {
                    var errMsg = "Something went wrong.";
                    if (data.error) { errMsg = data.error; }                                                    // server-side validation message (eg "Minors must be at least 8 years old")
                    if (errorEl) { errorEl.textContent = errMsg; errorEl.classList.remove("hidden"); }
                }
            } catch (netErr) {
                if (errorEl) { errorEl.textContent = "Network error. Please try again."; errorEl.classList.remove("hidden"); }
            } finally {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Add Minor"; }             // re-enable button regardless of success/failure
            }
        });
    }

    function fnRenderWaivers(waiverData) {                                                                      // paints the Waivers section using the {user, minors} payload from the API
        var loadingEl   = document.getElementById("waivers-loading");
        var containerEl = document.getElementById("waivers-container");

        if (loadingEl)   { loadingEl.classList.add("hidden"); }
        if (!containerEl) { return; }
        containerEl.innerHTML = "";
        containerEl.classList.remove("hidden");

        var userWaiver = waiverData.user;
        var userRow = document.createElement("div");
        userRow.className = "flex justify-between items-center px-5 py-4";
        var userSignedAt = userWaiver.waiver_accepted_at
            ? '<span class="text-ak-hint text-xs mt-0.5 block">' + new Date(userWaiver.waiver_accepted_at).toLocaleDateString("en-AU") + '</span>'
            : "";
        var userAction = userWaiver.waiver_accepted
            ? '<span class="text-green-400 text-sm font-medium flex items-center gap-1"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>Signed</span>'
            : '<button type="button" class="open-waiver-btn bg-ak-purple hover:bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors" data-type="user">Sign now</button>';
        userRow.innerHTML =
            '<div><p class="text-white text-sm font-medium">You</p>' + userSignedAt + '</div>' + userAction;
        containerEl.appendChild(userRow);

        var minors = waiverData.minors;
        if (minors) {
            for (var i = 0; i < minors.length; i++) {
                var m = minors[i];
                var mRow = document.createElement("div");
                mRow.className = "flex justify-between items-center px-5 py-4";
                var mSignedAt = m.waiver_accepted_at
                    ? '<span class="text-ak-hint text-xs mt-0.5 block">' + new Date(m.waiver_accepted_at).toLocaleDateString("en-AU") + '</span>'
                    : "";
                var mAction = m.waiver_accepted
                    ? '<span class="text-green-400 text-sm font-medium flex items-center gap-1"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>Signed</span>'
                    : '<button type="button" class="open-waiver-btn bg-ak-purple hover:bg-purple-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors" data-type="minor" data-id="' + m.id + '" data-name="' + m.name + '">Sign for ' + m.name.split(" ")[0] + '</button>';
                mRow.innerHTML =
                    '<div><p class="text-white text-sm font-medium">' + m.name + '</p>' + mSignedAt + '</div>' + mAction;
                containerEl.appendChild(mRow);
            }
        }

        var openBtns = containerEl.querySelectorAll(".open-waiver-btn");
        for (var j = 0; j < openBtns.length; j++) {
            (function (btn) {
                btn.addEventListener("click", function () {
                    var type = btn.getAttribute("data-type");
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

    function fnOpenWaiverModal(target) {                                                                        // opens the shared modal
        waiverTarget = target;                                                                                  // remember for the Sign button click handler
        var modal     = document.getElementById("waiver-modal");
        var titleEl   = document.getElementById("waiver-modal-title");
        var noteEl    = document.getElementById("waiver-guardian-note");
        var agreeLabel = document.getElementById("waiver-agree-label");
        var checkbox  = document.getElementById("waiver-agree-checkbox");
        var errorEl   = document.getElementById("waiver-modal-error");

        if (checkbox)  { checkbox.checked = false; }
        if (errorEl)   { errorEl.classList.add("hidden"); }

        var signBtn = document.getElementById("btn-sign-waiver");
        if (signBtn)   { signBtn.disabled = true; }

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

        if (modal) { modal.classList.remove("hidden"); }
    }

    function fnCloseWaiverModal() {                                                                             // clears the target and hides the modal
        waiverTarget = null;
        var modal = document.getElementById("waiver-modal");
        if (modal) { modal.classList.add("hidden"); }
    }

    function fnSetupWaiverModal() {                                                                             // wires the modals checkbox, sign button, cancel button, and backdrop click
        var checkbox = document.getElementById("waiver-agree-checkbox");
        var signBtn  = document.getElementById("btn-sign-waiver");
        var cancelBtn = document.getElementById("btn-cancel-waiver");
        var errorEl  = document.getElementById("waiver-modal-error");

        if (checkbox && signBtn) {                                                                              // Sign button is disabled until the agreement checkbox is ticked
            checkbox.addEventListener("change", function () {
                signBtn.disabled = !checkbox.checked;
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener("click", fnCloseWaiverModal);
        }

        if (signBtn) {
            signBtn.addEventListener("click", async function () {
                if (!waiverTarget) { return; }                                                                  // nothing to sign
                signBtn.disabled = true;
                signBtn.textContent = "Signing…";
                if (errorEl) { errorEl.classList.add("hidden"); }

                var url = "/api/users/me/waiver/sign";
                if (waiverTarget.type === "minor") {
                    url = "/api/users/me/minors/" + waiverTarget.id + "/waiver/sign";
                }

                var result = await fnPostJSON(url);
                if (result.success) {
                    fnCloseWaiverModal();
                    fnLoadDashboard();                                                                          // reload so the row swaps from "Sign now" → "Signed ✓"
                } else {
                    var errMsg = "Something went wrong.";
                    if (result.error) { errMsg = result.error; }
                    if (errorEl) { errorEl.textContent = errMsg; errorEl.classList.remove("hidden"); }
                    signBtn.disabled = false;
                    signBtn.textContent = "Sign";
                }
            });
        }

        var modal = document.getElementById("waiver-modal");
        if (modal) {
            modal.addEventListener("click", function (e) {
                if (e.target === modal) { fnCloseWaiverModal(); }                                               // only close when the click was on the backdrop, not inside the modal content
            });
        }
    }

    async function fnLoadDashboard() {                                                                          // fetches all 3 sections in parallel - saves time vs serial requests
        var results = await Promise.all([
            fnGetJSON("/api/users/me/bookings"),
            fnGetJSON("/api/users/me/minors"),
            fnGetJSON("/api/users/me/waiver-status"),
        ]);

        if (results[0].success) { fnRenderBookings(results[0].data); }
        if (results[1].success) { fnRenderMinors(results[1].data); }
        if (results[2].success) { fnRenderWaivers(results[2].data); }
    }


    function fnInit() {                                                                                         // entry point - loads at first
        fnSetupAddMinorForm();                                                                                  // wires up the add/remove minor form
        fnSetupWaiverModal();                                                                                   // wires up the waiver modal once (its content gets re-skinned each time it opens)
        fnLoadDashboard();                                                                                      // initial data fetch + render
    }

    document.addEventListener("DOMContentLoaded", fnInit);
})();
