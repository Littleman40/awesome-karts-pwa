(function () {
    "use strict";


    async function fnFetchJSON(requestUrl, fetchOptions) {                                  // fetch wrapper that always returns { ok, status, data } so callers don't repeat try/catch json
        fetchOptions = fetchOptions || {};
        fetchOptions.credentials = "same-origin";                                           // include session cookie so admin_id is sent
        var response = await fetch(requestUrl, fetchOptions);
        var responseData = {};
        try {
            responseData = await response.json();
        } catch (parseError) {}
        return { ok: response.ok, status: response.status, data: responseData };
    }

    async function fnPostJSON(requestUrl, requestBody) {                                    // shorthand for json post
        return fnFetchJSON(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody || {}),
        });
    }

    function fnShowError(elementId, message) {
        var element = document.getElementById(elementId);
        if (!element) return;
        element.textContent = message;
        element.classList.remove("hidden");
    }

    function fnClearError(elementId) {
        var element = document.getElementById(elementId);
        if (!element) return;
        element.textContent = "";
        element.classList.add("hidden");
    }

    function fnFormatCents(centsValue) {
        var amount = (centsValue || 0) / 100;
        return "$" + amount.toFixed(2);
    }

    function fnEscapeHtml(rawString) {                                                      // safe interpolation for table cells - never let server data become html
        if (rawString === null || rawString === undefined) return "";
        return String(rawString)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function fnFormatDateNice(yyyyMmDdString) {                                             // "2026-05-24" -> "Sun 24 May 2026"
        if (!yyyyMmDdString) return "";
        var parsedDate = new Date(yyyyMmDdString + "T00:00:00");
        if (isNaN(parsedDate.getTime())) return yyyyMmDdString;
        return parsedDate.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }

    function fnStatusBadge(status) {                                                        // coloured status pill html
        var label = (status || "").toUpperCase();
        var classes = "px-2 py-0.5 rounded-full text-[10px] font-semibold border";
        if (status === "paid")           classes += " bg-green-500/10 border-green-500/40 text-green-400";
        else if (status === "pending")   classes += " bg-yellow-500/10 border-yellow-500/40 text-yellow-300";
        else if (status === "cancelled") classes += " bg-red-500/10 border-red-500/40 text-red-400";
        else if (status === "refunded")  classes += " bg-blue-500/10 border-blue-500/40 text-blue-400";
        else classes += " bg-ak-border border-ak-border text-ak-muted";
        return '<span class="' + classes + '">' + fnEscapeHtml(label) + '</span>';
    }

    function fnPad2(n) { return n < 10 ? "0" + n : "" + n; }

    function fnFormatDateISO(dateObj) {                                                     // YYYY-MM-DD in local time (matches the public booking calendar's convention)
        return dateObj.getFullYear() + "-" + fnPad2(dateObj.getMonth() + 1) + "-" + fnPad2(dateObj.getDate());
    }

    function fnParseDateISO(yyyyMmDd) {
        var parts = yyyyMmDd.split("-");
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }

    function fnTodayLocal() {                                                               // local-time today at midnight
        var d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }


    // global - logout button wiring (any page with [data-admin-logout])
    document.querySelectorAll("[data-admin-logout]").forEach(function (logoutButton) {
        logoutButton.addEventListener("click", async function () {
            await fnPostJSON("/api/admin/auth/logout", {});
            window.location.href = "/admin/login";
        });
    });


    var loginForm = document.getElementById("admin-login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async function (submitEvent) {
            submitEvent.preventDefault();
            var errorElement = loginForm.querySelector("[data-form-error]");
            if (errorElement) { errorElement.classList.add("hidden"); errorElement.textContent = ""; }

            var email = loginForm.email.value.trim();
            var password = loginForm.password.value;
            if (!email || !password) {
                if (errorElement) {
                    errorElement.textContent = "Please enter your email and password.";
                    errorElement.classList.remove("hidden");
                }
                return;
            }

            var result = await fnPostJSON("/api/admin/auth/login", { email: email, password: password });
            if (result.data && result.data.success) {
                window.location.href = (result.data.data && result.data.data.redirect) || "/admin";
            } else {
                var message = (result.data && result.data.error) || "Login failed. Please try again.";
                if (errorElement) {
                    errorElement.textContent = message;
                    errorElement.classList.remove("hidden");
                }
            }
        });
    }


    var MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    function fnRenderCalendarGrid(rootIds, state, opts) {                                   // rootIds = { titleId, gridId, prevId, nextId }, opts = { decorateCell, allowPrev, allowNext, displayInfoId, displayInfoText }
        var titleEl = document.getElementById(rootIds.titleId);
        var gridEl  = document.getElementById(rootIds.gridId);
        var prevBtn = document.getElementById(rootIds.prevId);
        var nextBtn = document.getElementById(rootIds.nextId);
        if (!titleEl || !gridEl) return;

        var today = fnTodayLocal();
        var firstOfView = new Date(today.getFullYear(), today.getMonth() + state.offset, 1);
        var viewYear  = firstOfView.getFullYear();
        var viewMonth = firstOfView.getMonth();
        titleEl.textContent = MONTH_NAMES[viewMonth] + " " + viewYear;

        if (prevBtn) prevBtn.disabled = !opts.allowPrev(state.offset);
        if (nextBtn) nextBtn.disabled = !opts.allowNext(state.offset);

        if (opts.displayInfoId) {
            var infoEl = document.getElementById(opts.displayInfoId);
            if (infoEl) infoEl.textContent = opts.displayInfoText || "";
        }

        gridEl.innerHTML = "";

        var firstDow    = new Date(viewYear, viewMonth, 1).getDay();
        var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        for (var b = 0; b < firstDow; b++) {
            var blank = document.createElement("div");
            blank.className = "h-9";
            gridEl.appendChild(blank);
        }

        for (var day = 1; day <= daysInMonth; day++) {
            var dayDate = new Date(viewYear, viewMonth, day);
            var dayIso  = fnFormatDateISO(dayDate);
            var cell    = document.createElement("button");
            cell.type = "button";
            cell.textContent = day;
            cell.setAttribute("data-date", dayIso);
            cell.className = "h-9 rounded-lg text-sm font-medium flex items-center justify-center transition-colors";
            opts.decorateCell(dayIso, dayDate, today, cell);                                // caller adds colour, click handler, disabled state, etc
            gridEl.appendChild(cell);
        }
    }


    var bookingsCalState = { offset: 0, selectedIso: null };
    var BOOKINGS_PAST_MONTHS = 12;                                                          // how far back the admin can browse (1 year is plenty)
    var BOOKINGS_FUTURE_MONTHS = 6;                                                         // and how far forward

    function fnDecorateBookingsCell(dayIso, dayDate, today, cell) {
        var isSelected = bookingsCalState.selectedIso === dayIso;
        var isToday    = dayDate.getTime() === today.getTime();
        var baseClass  = cell.className;
        if (isSelected) {
            cell.className = baseClass + " bg-ak-purple text-white";
        } else if (isToday) {
            cell.className = baseClass + " bg-ak-border text-white hover:bg-ak-purple cursor-pointer";
        } else {
            cell.className = baseClass + " text-white hover:bg-ak-border cursor-pointer";
        }
        cell.addEventListener("click", function () {
            bookingsCalState.selectedIso = dayIso;
            fnRenderBookingsCalendar();
            fnLoadBookingsForDate(dayIso);
        });
    }

    function fnRenderBookingsCalendar() {
        fnRenderCalendarGrid(
            { titleId: "bk-cal-title", gridId: "bk-cal-grid", prevId: "bk-cal-prev", nextId: "bk-cal-next" },
            bookingsCalState,
            {
                allowPrev: function (offset) { return offset > -BOOKINGS_PAST_MONTHS; },
                allowNext: function (offset) { return offset <  BOOKINGS_FUTURE_MONTHS; },
                decorateCell: fnDecorateBookingsCell,
                displayInfoId: "bk-date-display",
                displayInfoText: bookingsCalState.selectedIso ? fnFormatDateNice(bookingsCalState.selectedIso) : "",
            }
        );
    }

    async function fnLoadBookingsForDate(dateIso) {
        var loadingEl = document.getElementById("bk-hours-loading");
        var listEl    = document.getElementById("bk-hours-list");
        var emptyEl   = document.getElementById("bk-hours-empty");
        var bannerEl  = document.getElementById("bk-day-blocked-banner");
        var summaryEl = document.getElementById("bk-hour-summary");

        loadingEl.textContent = "Loading…";
        loadingEl.classList.remove("hidden");
        listEl.classList.add("hidden");
        emptyEl.classList.add("hidden");
        bannerEl.classList.add("hidden");
        summaryEl.textContent = "";

        var result = await fnFetchJSON("/api/admin/bookings/by-date?date=" + encodeURIComponent(dateIso));
        if (!result.ok || !result.data.success) {
            loadingEl.textContent = (result.data && result.data.error) || "Could not load bookings for this date.";
            return;
        }
        var data = result.data.data;

        if (data.is_day_blocked) {
            document.getElementById("bk-day-blocked-reason").textContent = data.blocked_reason || "Blocked by admin.";
            bannerEl.classList.remove("hidden");
        }

        var hours = data.hours || [];
        if (hours.length === 0 && !data.is_day_blocked) {                                   // closed weekday or no opening hours
            loadingEl.textContent = "Closed on this weekday (no opening hours set).";
            return;
        }

        var totalDriversDay = 0;
        var totalBookingsDay = 0;
        listEl.innerHTML = "";
        hours.forEach(function (hour) {
            totalDriversDay += hour.drivers_total;
            var activeBookings = hour.bookings.filter(function (b) { return b.payment_status !== "cancelled" && b.payment_status !== "refunded"; });
            totalBookingsDay += activeBookings.length;

            var headerHtml =
                '<div class="flex items-center justify-between px-4 py-2 bg-ak-border/40">' +
                    '<p class="text-white text-sm font-semibold">' + fnEscapeHtml(hour.label) + '</p>' +
                    '<p class="text-ak-muted text-xs">' + hour.drivers_total + ' / ' + hour.max_capacity + ' drivers</p>' +
                '</div>';

            var bookingsHtml = "";
            if (hour.bookings.length === 0) {
                bookingsHtml = '<div class="px-4 py-3 text-ak-muted text-xs">No bookings.</div>';
            } else {
                bookingsHtml = hour.bookings.map(function (booking) {
                    var customerName = "(unknown)";
                    var customerEmail = "";
                    if (booking.creator) {
                        customerName = (booking.creator.first_name + " " + booking.creator.last_name).trim();
                        if (!customerName) customerName = booking.creator.email || "(unknown)";
                        customerEmail = booking.creator.email || "";
                    }
                    return '<div class="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">' +
                        '<div class="min-w-0">' +
                            '<p class="text-white text-sm font-medium truncate">' + fnEscapeHtml(customerName) + '</p>' +
                            '<p class="text-ak-muted text-xs truncate">' + fnEscapeHtml(customerEmail) + '</p>' +
                        '</div>' +
                        '<div class="flex items-center gap-3 shrink-0">' +
                            '<p class="text-ak-muted text-xs"><span class="text-white">' + booking.adult_count + 'A + ' + booking.junior_count + 'J</span> &middot; ' + fnEscapeHtml(booking.package_label) + '</p>' +
                            fnStatusBadge(booking.payment_status) +
                            '<button data-action="view"   data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-white border border-ak-border hover:border-ak-purple px-2 py-1 rounded-full transition-colors">View</button>' +
                            '<button data-action="cancel" data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-red-400 border border-red-500/40 hover:bg-red-500 hover:text-white px-2 py-1 rounded-full transition-colors">Cancel</button>' +
                            '<button data-action="refund" data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-blue-400 border border-blue-500/40 hover:bg-blue-500 hover:text-white px-2 py-1 rounded-full transition-colors">Refund</button>' +
                        '</div>' +
                    '</div>';
                }).join('<div class="border-t border-ak-border"></div>');
            }

            var card = document.createElement("div");
            card.className = "bg-ak-bg/40 border border-ak-border rounded-lg overflow-hidden";
            card.innerHTML = headerHtml + bookingsHtml;
            listEl.appendChild(card);
        });

        summaryEl.textContent = totalBookingsDay + " bookings, " + totalDriversDay + " drivers";
        loadingEl.classList.add("hidden");
        listEl.classList.remove("hidden");
    }

    async function fnHandleBookingAction(action, bookingId) {
        if (action === "view") {
            await fnOpenBookingDetail(bookingId);
            return;
        }
        if (action === "cancel") {
            if (!confirm("Cancel this booking? This will free up the slot capacity. This cannot be undone.")) return;
            var cancelResult = await fnPostJSON("/api/admin/bookings/" + encodeURIComponent(bookingId) + "/cancel", {});
            if (!cancelResult.ok || !cancelResult.data.success) {
                alert((cancelResult.data && cancelResult.data.error) || "Could not cancel booking.");
                return;
            }
            if (bookingsCalState.selectedIso) fnLoadBookingsForDate(bookingsCalState.selectedIso);
            return;
        }
        if (action === "refund") {
            if (!confirm("Refund this booking? In v2 this only changes the status; v3 will trigger a real Stripe refund. The slot capacity will be freed.")) return;
            var refundResult = await fnPostJSON("/api/admin/bookings/" + encodeURIComponent(bookingId) + "/refund", {});
            if (!refundResult.ok || !refundResult.data.success) {
                alert((refundResult.data && refundResult.data.error) || "Could not refund booking.");
                return;
            }
            if (bookingsCalState.selectedIso) fnLoadBookingsForDate(bookingsCalState.selectedIso);
            return;
        }
    }

    async function fnOpenBookingDetail(bookingId) {                                         // GET /api/admin/bookings/<id> and render the modal
        var result = await fnFetchJSON("/api/admin/bookings/" + encodeURIComponent(bookingId));
        if (!result.ok || !result.data.success) {
            alert("Could not load booking detail.");
            return;
        }
        var booking = result.data.data;
        document.getElementById("booking-detail-ref").textContent = "Ref " + booking.ref;
        var linkedUsersHtml = "(none)";
        if (booking.linked_users && booking.linked_users.length > 0) {
            linkedUsersHtml = "<ul class='space-y-1'>" + booking.linked_users.map(function (u) {
                var name = (u.first_name + " " + u.last_name).trim() || u.email;
                return "<li>" + fnEscapeHtml(name) + " &middot; <span class='text-ak-muted'>" + fnEscapeHtml(u.email) + "</span></li>";
            }).join("") + "</ul>";
        }
        document.getElementById("booking-detail-body").innerHTML =
            '<div class="grid grid-cols-2 gap-3 mb-4">' +
                '<div><p class="text-ak-muted text-xs">Date</p><p>' + fnEscapeHtml(fnFormatDateNice(booking.date)) + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">Time</p><p>' + fnEscapeHtml(booking.time_label) + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">Package</p><p>' + fnEscapeHtml(booking.package_label) + (booking.extra_rides ? ' (+' + booking.extra_rides + ' extra)' : '') + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">Drivers</p><p>' + booking.adult_count + ' Adult, ' + booking.junior_count + ' Junior</p></div>' +
                '<div><p class="text-ak-muted text-xs">Total</p><p>' + fnFormatCents(booking.total_amount) + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">Status</p><p>' + fnStatusBadge(booking.payment_status) + '</p></div>' +
            '</div>' +
            '<div class="border-t border-ak-border pt-3 mt-2">' +
                '<p class="text-ak-muted text-xs mb-2">Linked Users</p>' +
                linkedUsersHtml +
            '</div>';
        document.getElementById("booking-detail-modal").classList.remove("hidden");
    }

    function fnWireBookingsPage() {
        document.getElementById("bk-cal-prev").addEventListener("click", function () {
            if (bookingsCalState.offset > -BOOKINGS_PAST_MONTHS) { bookingsCalState.offset -= 1; fnRenderBookingsCalendar(); }
        });
        document.getElementById("bk-cal-next").addEventListener("click", function () {
            if (bookingsCalState.offset <  BOOKINGS_FUTURE_MONTHS) { bookingsCalState.offset += 1; fnRenderBookingsCalendar(); }
        });

        document.getElementById("bk-hours-list").addEventListener("click", function (clickEvent) {
            var target = clickEvent.target.closest("button[data-action]");
            if (!target) return;
            fnHandleBookingAction(target.getAttribute("data-action"), target.getAttribute("data-id"));
        });

        document.querySelectorAll("[data-close-detail]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.getElementById("booking-detail-modal").classList.add("hidden");
            });
        });
        document.querySelectorAll("[data-close-manual]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.getElementById("manual-booking-modal").classList.add("hidden");
            });
        });

        document.getElementById("btn-open-manual-booking").addEventListener("click", function () {
            fnClearError("manual-booking-error");
            document.getElementById("manual-booking-form").reset();
            document.getElementById("m-adults").value = 1;
            document.getElementById("m-juniors").value = 0;
            document.getElementById("m-extra").value = 0;
            if (bookingsCalState.selectedIso) {                                             // pre-fill the date field with whatever the admin's looking at
                document.getElementById("m-date").value = bookingsCalState.selectedIso;
            }
            document.getElementById("manual-booking-modal").classList.remove("hidden");
        });

        document.getElementById("manual-booking-form").addEventListener("submit", async function (submitEvent) {
            submitEvent.preventDefault();
            fnClearError("manual-booking-error");
            var payload = {
                customer_email: document.getElementById("m-customer-email").value.trim(),
                date:           document.getElementById("m-date").value,
                time_slot:      document.getElementById("m-time").value,
                adult_count:    document.getElementById("m-adults").value,
                junior_count:   document.getElementById("m-juniors").value,
                package_id:     document.getElementById("m-package").value,
                extra_rides:    document.getElementById("m-extra").value,
            };
            var result = await fnPostJSON("/api/admin/bookings/create", payload);
            if (!result.ok || !result.data.success) {
                fnShowError("manual-booking-error", (result.data && result.data.error) || "Could not create booking.");
                return;
            }
            document.getElementById("manual-booking-modal").classList.add("hidden");
            if (payload.date) {                                                             // jump the calendar to the newly created booking's date and refresh the hour view
                bookingsCalState.selectedIso = payload.date;
                var today = fnTodayLocal();
                var picked = fnParseDateISO(payload.date);
                bookingsCalState.offset = (picked.getFullYear() - today.getFullYear()) * 12 + (picked.getMonth() - today.getMonth());
                fnRenderBookingsCalendar();
                fnLoadBookingsForDate(payload.date);
            }
        });
    }

    function fnInitBookingsPage() {
        var todayIso = fnFormatDateISO(fnTodayLocal());
        bookingsCalState.selectedIso = todayIso;                                            // start on today
        fnWireBookingsPage();
        fnRenderBookingsCalendar();
        fnLoadBookingsForDate(todayIso);
    }


    async function fnRunCustomerSearch(queryText) {
        var loading = document.getElementById("cust-loading");
        var wrapper = document.getElementById("cust-table-wrapper");
        var tbody   = document.getElementById("cust-tbody");
        var empty   = document.getElementById("cust-empty");
        var emptyState = document.getElementById("cust-empty-state");

        emptyState.classList.add("hidden");
        loading.classList.remove("hidden");
        wrapper.classList.add("hidden");

        var result = await fnFetchJSON("/api/admin/customers?q=" + encodeURIComponent(queryText));
        loading.classList.add("hidden");
        if (!result.ok || !result.data.success) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-red-400 text-sm">' + fnEscapeHtml((result.data && result.data.error) || "Could not load customers.") + '</td></tr>';
            wrapper.classList.remove("hidden");
            return;
        }
        var customers = result.data.data.customers || [];
        tbody.innerHTML = "";
        if (customers.length === 0) {
            empty.classList.remove("hidden");
        } else {
            empty.classList.add("hidden");
            customers.forEach(function (customer) {
                var fullName = (customer.first_name + " " + customer.last_name).trim();
                var row = document.createElement("tr");
                row.className = "cursor-pointer hover:bg-ak-border/40";
                row.setAttribute("data-customer-id", customer.id);
                row.innerHTML =
                    '<td class="px-3 py-2">' + fnEscapeHtml(fullName || "(no name)") + '</td>' +
                    '<td class="px-3 py-2">' + fnEscapeHtml(customer.email) + '</td>' +
                    '<td class="px-3 py-2">' + fnEscapeHtml(customer.phone || "") + '</td>' +
                    '<td class="px-3 py-2">' + fnEscapeHtml(customer.dob || "") + '</td>';
                tbody.appendChild(row);
            });
        }
        wrapper.classList.remove("hidden");
    }

    async function fnOpenCustomerProfile(customerId) {
        var result = await fnFetchJSON("/api/admin/customers/" + encodeURIComponent(customerId));
        if (!result.ok || !result.data.success) {
            alert("Could not load customer.");
            return;
        }
        var customer = result.data.data;
        var fullName = (customer.first_name + " " + customer.last_name).trim() || "(no name)";
        document.getElementById("cust-profile-name").textContent = fullName;
        document.getElementById("cust-profile-email").textContent = customer.email || "";

        var minorsHtml = "(none registered)";
        if (customer.minors && customer.minors.length > 0) {
            minorsHtml = customer.minors.map(function (minor) {
                var waiverBadge = minor.waiver_accepted
                    ? '<span class="text-green-400 text-xs">waiver signed</span>'
                    : '<span class="text-red-400 text-xs">waiver missing</span>';
                return '<li class="flex items-center justify-between"><span>' + fnEscapeHtml(minor.first_name + " " + minor.last_name) + ' &middot; <span class="text-ak-muted">age ' + minor.age + '</span></span>' + waiverBadge + '</li>';
            }).join("");
            minorsHtml = '<ul class="space-y-1">' + minorsHtml + '</ul>';
        }

        var bookingsHtml = "(none)";
        if (customer.bookings && customer.bookings.length > 0) {
            bookingsHtml = customer.bookings.map(function (booking) {
                return '<tr>' +
                    '<td class="px-2 py-1">' + fnEscapeHtml(fnFormatDateNice(booking.date)) + '</td>' +
                    '<td class="px-2 py-1">' + fnEscapeHtml(booking.time_label) + '</td>' +
                    '<td class="px-2 py-1">' + booking.adult_count + 'A + ' + booking.junior_count + 'J</td>' +
                    '<td class="px-2 py-1">' + fnFormatCents(booking.total_amount) + '</td>' +
                    '<td class="px-2 py-1">' + fnStatusBadge(booking.payment_status) + '</td>' +
                '</tr>';
            }).join("");
            bookingsHtml = '<table class="min-w-full text-xs"><thead class="text-ak-muted"><tr>' +
                '<th class="px-2 py-1 text-left">Date</th><th class="px-2 py-1 text-left">Time</th><th class="px-2 py-1 text-left">Drivers</th><th class="px-2 py-1 text-left">Total</th><th class="px-2 py-1 text-left">Status</th>' +
                '</tr></thead><tbody class="divide-y divide-ak-border">' + bookingsHtml + '</tbody></table>';
        }

        var waiverBadge = customer.waiver_accepted ? '<span class="text-green-400">signed</span>' : '<span class="text-red-400">missing</span>';

        document.getElementById("cust-profile-body").innerHTML =
            '<div class="grid grid-cols-2 gap-3 text-sm mb-5">' +
                '<div><p class="text-ak-muted text-xs">Phone</p><p>' + fnEscapeHtml(customer.phone || "-") + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">DOB</p><p>' + fnEscapeHtml(customer.dob || "-") + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">Gender</p><p>' + fnEscapeHtml(customer.gender || "-") + '</p></div>' +
                '<div><p class="text-ak-muted text-xs">Created</p><p>' + fnEscapeHtml((customer.created_at || "").substring(0, 10) || "-") + '</p></div>' +
                '<div class="col-span-2"><p class="text-ak-muted text-xs">Address</p><p>' + fnEscapeHtml(customer.address || "-") + '</p></div>' +
                '<div class="col-span-2"><p class="text-ak-muted text-xs">Adult Waiver</p><p>' + waiverBadge + '</p></div>' +
            '</div>' +
            '<div class="mb-5"><p class="text-ak-muted text-xs mb-2">Minors</p>' + minorsHtml + '</div>' +
            '<div><p class="text-ak-muted text-xs mb-2">Bookings</p>' + bookingsHtml + '</div>';

        document.getElementById("cust-profile-modal").classList.remove("hidden");
    }

    function fnWireCustomersPage() {
        function fnDoSearch() {
            var queryText = document.getElementById("cust-search").value.trim();
            if (!queryText) {                                                               // refuse empty searches - show the empty-state hint instead
                document.getElementById("cust-table-wrapper").classList.add("hidden");
                document.getElementById("cust-empty-state").classList.remove("hidden");
                return;
            }
            fnRunCustomerSearch(queryText);
        }
        document.getElementById("btn-cust-search").addEventListener("click", fnDoSearch);
        document.getElementById("cust-search").addEventListener("keydown", function (keyEvent) {
            if (keyEvent.key === "Enter") fnDoSearch();
        });
        document.getElementById("cust-tbody").addEventListener("click", function (clickEvent) {
            var row = clickEvent.target.closest("tr[data-customer-id]");
            if (!row) return;
            fnOpenCustomerProfile(row.getAttribute("data-customer-id"));
        });
        document.querySelectorAll("[data-close-profile]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.getElementById("cust-profile-modal").classList.add("hidden");
            });
        });
    }



    async function fnLoadSettings() {
        var loading = document.getElementById("settings-loading");
        var form = document.getElementById("settings-form");
        loading.classList.remove("hidden");
        form.classList.add("hidden");

        var result = await fnFetchJSON("/api/admin/settings");
        loading.classList.add("hidden");
        if (!result.ok || !result.data.success) {
            loading.textContent = "Could not load settings.";
            loading.classList.remove("hidden");
            return;
        }
        var settings = result.data.data;
        document.getElementById("settings-capacity").value = settings.max_capacity_per_slot || 50;
        form.classList.remove("hidden");
    }

    function fnWireSettingsForm() {
        document.getElementById("settings-form").addEventListener("submit", async function (submitEvent) {
            submitEvent.preventDefault();
            fnClearError("settings-error");
            document.getElementById("settings-success").classList.add("hidden");

            var payload = {
                max_capacity_per_slot: parseInt(document.getElementById("settings-capacity").value, 10) || 50,
            };

            var result = await fnFetchJSON("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!result.ok || !result.data.success) {
                fnShowError("settings-error", (result.data && result.data.error) || "Could not save settings.");
                return;
            }
            document.getElementById("settings-success").classList.remove("hidden");
        });
    }


    var settingsBlockState = {
        offset: 0,
        selectedIso: null,
        isDayBlocked: false,                                                                // mirrors the most recent by-date response
        blockedDateSet: {},                                                                 // map of YYYY-MM-DD -> reason for any date in the visible window
    };
    var SET_PAST_MONTHS   = 0;                                                              // admin shouldn't block past dates
    var SET_FUTURE_MONTHS = 12;

    async function fnRefreshSettingsBlockedDays() {                                         // pulls the visible window of blocked days so the calendar can tint them red
        var today = fnTodayLocal();
        var fromIso = fnFormatDateISO(today);
        var toDate = new Date(today.getFullYear(), today.getMonth() + SET_FUTURE_MONTHS + 1, 0);
        var toIso = fnFormatDateISO(toDate);
        var result = await fnFetchJSON("/api/admin/days?from=" + fromIso + "&to=" + toIso);
        settingsBlockState.blockedDateSet = {};
        if (result.ok && result.data && result.data.success) {
            (result.data.data.days || []).forEach(function (d) {
                if (d.is_blocked) settingsBlockState.blockedDateSet[d.date] = d.blocked_reason || "";
            });
        }
    }

    function fnDecorateSettingsCalCell(dayIso, dayDate, today, cell) {
        var isPast     = dayDate < today;
        var isSelected = settingsBlockState.selectedIso === dayIso;
        var isToday    = dayDate.getTime() === today.getTime();
        var isBlocked  = Object.prototype.hasOwnProperty.call(settingsBlockState.blockedDateSet, dayIso);
        var baseClass  = cell.className;
        if (isPast) {                                                                       // past dates are non-interactive
            cell.className = baseClass + " text-ak-hint cursor-not-allowed opacity-40";
            cell.disabled = true;
            return;
        }
        if (isSelected) {
            cell.className = baseClass + " bg-ak-purple text-white" + (isBlocked ? " ring-2 ring-red-500/70" : "");
        } else if (isBlocked) {
            cell.className = baseClass + " bg-red-500/20 border border-red-500/60 text-red-300 hover:bg-red-500/30 cursor-pointer";
            cell.title = settingsBlockState.blockedDateSet[dayIso] || "Blocked";
        } else if (isToday) {
            cell.className = baseClass + " bg-ak-border text-white hover:bg-ak-purple cursor-pointer";
        } else {
            cell.className = baseClass + " text-white hover:bg-ak-border cursor-pointer";
        }
        cell.addEventListener("click", function () {
            settingsBlockState.selectedIso = dayIso;
            fnRenderSettingsCalendar();
            fnLoadSettingsHoursForDate(dayIso);
        });
    }

    function fnRenderSettingsCalendar() {
        fnRenderCalendarGrid(
            { titleId: "set-cal-title", gridId: "set-cal-grid", prevId: "set-cal-prev", nextId: "set-cal-next" },
            settingsBlockState,
            {
                allowPrev: function (offset) { return offset > SET_PAST_MONTHS; },
                allowNext: function (offset) { return offset < SET_FUTURE_MONTHS; },
                decorateCell: fnDecorateSettingsCalCell,
                displayInfoId: "set-date-display",
                displayInfoText: settingsBlockState.selectedIso ? fnFormatDateNice(settingsBlockState.selectedIso) : "",
            }
        );
    }

    function fnUpdateDayBlockButton() {                                                     // refreshes the button label and colour to match the current selection
        var btn = document.getElementById("btn-set-block-day");
        if (!btn) return;
        if (!settingsBlockState.selectedIso) {
            btn.disabled = true;
            btn.textContent = "Pick a date to block";
            btn.className = "w-full bg-ak-card border border-ak-border disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-full transition-colors";
            return;
        }
        btn.disabled = false;
        if (settingsBlockState.isDayBlocked) {
            btn.textContent = "Unblock this day";
            btn.className = "w-full bg-red-500/15 border border-red-500/60 hover:bg-red-500 hover:text-white text-red-300 text-sm font-medium px-4 py-2.5 rounded-full transition-colors";
        } else {
            btn.textContent = "Block this day";
            btn.className = "w-full bg-ak-card border border-ak-border hover:border-ak-purple text-white text-sm font-medium px-4 py-2.5 rounded-full transition-colors";
        }
    }

    async function fnLoadSettingsHoursForDate(dateIso) {
        var loadingEl = document.getElementById("set-hours-loading");
        var listEl    = document.getElementById("set-hours-list");
        var emptyEl   = document.getElementById("set-hours-empty");
        var bannerEl  = document.getElementById("set-day-blocked-banner");
        var summaryEl = document.getElementById("set-hour-summary");

        loadingEl.textContent = "Loading…";
        loadingEl.classList.remove("hidden");
        listEl.classList.add("hidden");
        emptyEl.classList.add("hidden");
        bannerEl.classList.add("hidden");
        summaryEl.textContent = "";

        var result = await fnFetchJSON("/api/admin/bookings/by-date?date=" + encodeURIComponent(dateIso));
        if (!result.ok || !result.data.success) {
            loadingEl.textContent = (result.data && result.data.error) || "Could not load hours for this date.";
            settingsBlockState.isDayBlocked = false;
            fnUpdateDayBlockButton();
            return;
        }
        var data = result.data.data;
        settingsBlockState.isDayBlocked = !!data.is_day_blocked;
        fnUpdateDayBlockButton();

        if (data.is_day_blocked) {
            document.getElementById("set-day-blocked-reason").textContent = data.blocked_reason || "Blocked by admin.";
            bannerEl.classList.remove("hidden");
        }

        var hours = data.hours || [];
        if (hours.length === 0) {
            loadingEl.textContent = data.is_day_blocked ? "" : "Closed on this weekday (no opening hours set).";
            return;
        }

        var totalBlockedHours = 0;
        listEl.innerHTML = "";
        hours.forEach(function (hour) {
            if (hour.is_blocked) totalBlockedHours += 1;
            var blockBtnLabel = hour.is_blocked ? "Unblock hour" : "Block hour";
            var blockBtnClass = hour.is_blocked
                ? "text-xs text-red-300 border border-red-500/60 bg-red-500/10 hover:bg-red-500 hover:text-white px-3 py-1 rounded-full transition-colors"
                : "text-xs text-white border border-ak-border hover:border-ak-purple px-3 py-1 rounded-full transition-colors";

            var headerHtml =
                '<div class="flex items-center justify-between px-4 py-2 bg-ak-border/40">' +
                    '<p class="text-white text-sm font-semibold">' + fnEscapeHtml(hour.label) + '</p>' +
                    '<button type="button" data-set-hour-block="' + hour.hour + '" data-currently-blocked="' + (hour.is_blocked ? "1" : "0") + '" class="' + blockBtnClass + '">' + blockBtnLabel + '</button>' +
                '</div>';

            var bookingsHtml = "";
            if (hour.bookings.length === 0) {
                bookingsHtml = '<div class="px-4 py-3 text-ak-muted text-xs">No bookings.</div>';
            } else {
                bookingsHtml = hour.bookings.map(function (booking) {
                    var customerName = "(unknown)";
                    var customerEmail = "";
                    if (booking.creator) {
                        customerName = (booking.creator.first_name + " " + booking.creator.last_name).trim();
                        if (!customerName) customerName = booking.creator.email || "(unknown)";
                        customerEmail = booking.creator.email || "";
                    }
                    return '<div class="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">' +
                        '<div class="min-w-0">' +
                            '<p class="text-white text-sm font-medium truncate">' + fnEscapeHtml(customerName) + '</p>' +
                            '<p class="text-ak-muted text-xs truncate">' + fnEscapeHtml(customerEmail) + '</p>' +
                        '</div>' +
                        '<div class="flex items-center gap-3 shrink-0">' +
                            '<p class="text-ak-muted text-xs"><span class="text-white">' + booking.adult_count + 'A + ' + booking.junior_count + 'J</span> &middot; ' + fnEscapeHtml(booking.package_label) + '</p>' +
                            fnStatusBadge(booking.payment_status) +
                        '</div>' +
                    '</div>';
                }).join('<div class="border-t border-ak-border"></div>');
            }

            var card = document.createElement("div");
            card.className = "bg-ak-bg/40 border border-ak-border rounded-lg overflow-hidden" + (hour.is_blocked ? " ring-1 ring-red-500/40" : "");
            card.innerHTML = headerHtml + bookingsHtml;
            listEl.appendChild(card);
        });

        summaryEl.textContent = totalBlockedHours + " of " + hours.length + " hours blocked";
        loadingEl.classList.add("hidden");
        listEl.classList.remove("hidden");
    }

    async function fnToggleSettingsDayBlock() {
        if (!settingsBlockState.selectedIso) return;
        var dateIso = settingsBlockState.selectedIso;
        if (settingsBlockState.isDayBlocked) {
            if (!confirm("Unblock " + fnFormatDateNice(dateIso) + " for bookings?")) return;
            var unblockResult = await fnPostJSON("/api/admin/days/unblock", { date: dateIso });
            if (!unblockResult.ok || !unblockResult.data.success) {
                alert((unblockResult.data && unblockResult.data.error) || "Could not unblock the date.");
                return;
            }
        } else {
            var reason = prompt("Optional reason for blocking " + fnFormatDateNice(dateIso) + ":");
            if (reason === null) return;
            var blockResult = await fnPostJSON("/api/admin/days/block", { date: dateIso, reason: reason });
            if (!blockResult.ok || !blockResult.data.success) {
                alert((blockResult.data && blockResult.data.error) || "Could not block the date.");
                return;
            }
        }
        await fnRefreshSettingsBlockedDays();
        fnRenderSettingsCalendar();
        await fnLoadSettingsHoursForDate(dateIso);                                          // reload to refresh banner + button label
    }

    async function fnToggleSettingsHourBlock(hour, currentlyBlocked) {
        if (!settingsBlockState.selectedIso) return;
        var dateIso = settingsBlockState.selectedIso;
        if (currentlyBlocked) {
            if (!confirm("Unblock this hour?")) return;
            var unblockResult = await fnPostJSON("/api/admin/slots/unblock", { date: dateIso, hour: hour });
            if (!unblockResult.ok || !unblockResult.data.success) {
                alert((unblockResult.data && unblockResult.data.error) || "Could not unblock the hour.");
                return;
            }
        } else {
            var reason = prompt("Optional reason for blocking this hour:");
            if (reason === null) return;
            var blockResult = await fnPostJSON("/api/admin/slots/block", { date: dateIso, hour: hour, reason: reason });
            if (!blockResult.ok || !blockResult.data.success) {
                alert((blockResult.data && blockResult.data.error) || "Could not block the hour.");
                return;
            }
        }
        await fnLoadSettingsHoursForDate(dateIso);                                          // refresh the hour list to update button labels and ring colours
    }

    function fnWireSettingsBlockSection() {
        document.getElementById("set-cal-prev").addEventListener("click", function () {
            if (settingsBlockState.offset > SET_PAST_MONTHS) { settingsBlockState.offset -= 1; fnRenderSettingsCalendar(); }
        });
        document.getElementById("set-cal-next").addEventListener("click", function () {
            if (settingsBlockState.offset < SET_FUTURE_MONTHS) { settingsBlockState.offset += 1; fnRenderSettingsCalendar(); }
        });
        document.getElementById("btn-set-block-day").addEventListener("click", fnToggleSettingsDayBlock);
        document.getElementById("set-hours-list").addEventListener("click", function (clickEvent) {
            var target = clickEvent.target.closest("button[data-set-hour-block]");
            if (!target) return;
            var hour = parseInt(target.getAttribute("data-set-hour-block"), 10);
            var currentlyBlocked = target.getAttribute("data-currently-blocked") === "1";
            fnToggleSettingsHourBlock(hour, currentlyBlocked);
        });
    }

    async function fnInitSettingsPage() {
        fnWireSettingsForm();
        fnWireSettingsBlockSection();
        await fnLoadSettings();
        await fnRefreshSettingsBlockedDays();

        var todayIso = fnFormatDateISO(fnTodayLocal());
        settingsBlockState.selectedIso = todayIso;                                          // start on today so admin sees something immediately
        fnRenderSettingsCalendar();
        fnUpdateDayBlockButton();
        fnLoadSettingsHoursForDate(todayIso);
    }


    var currentPath = window.location.pathname.replace(/\/$/, "");
    if (currentPath === "/admin/bookings")         { fnInitBookingsPage(); }
    else if (currentPath === "/admin/customers")   { fnWireCustomersPage(); }
    else if (currentPath === "/admin/settings")    { fnInitSettingsPage(); }
})();
