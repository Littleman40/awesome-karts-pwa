// client sided js allowing for nice admin panels - functions and also popups etc
(function () {

    // strict mode, which gives errors for undeclared variable, and other bad practices
    "use strict";



    // fetch wrapper that always returns { ok, status, data } so callers don't repeat try/catch json
    async function fnFetchJSON(requestUrl, fetchOptions) {

        // makes sure fetch options exists
        fetchOptions = fetchOptions || {};

        // sends cookie for auth session but only if its our own backend
        fetchOptions.credentials = "same-origin";

        // fetches the http request and pauses until it completes
        var response = await fetch(requestUrl, fetchOptions);
        
        var responseData = {};
        
        // attempts to put response into json but if it fails respond with that
        try {
            responseData = await response.json();
        } catch (parseError) {}

        // return error
        return { ok: response.ok, status: response.status, data: responseData };
    }



    // shorthand for json post
    async function fnPostJSON(requestUrl, requestBody) {
        return fnFetchJSON(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody || {}),
        });
    }



    // shown an error message in an element
    function fnShowError(elementId, message) {

        // finds the element with the id
        var element = document.getElementById(elementId);

        // if there is no element just return
        if (!element) return;

        // set the message
        element.textContent = message;

        // show the error
        element.classList.remove("hidden");
    }


    // clears the error message
    function fnClearError(elementId) {

        // finds the element with the id
        var element = document.getElementById(elementId);

        // if there i sno element just return
        if (!element) return;

        // sets error message to nothing
        element.textContent = "";

        // hides it again
        element.classList.add("hidden");
    }


    // formats cents to dollars, fixed to 2 decimals
    function fnFormatCents(centsValue) {
        var amount = (centsValue || 0) / 100;
        return "$" + amount.toFixed(2);
    }



    // turns unsafe strings to safe ones by replacing characters
    function fnEscapeHtml(rawString) {
        if (rawString === null || rawString === undefined) return "";
        return String(rawString)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }



    // takes a data strign and turns it into a nice readable version, eg "2026-05-24" -> "Sun 24 May 2026"
    function fnFormatDateNice(yyyyMmDdString) {

        // if it doesnt exist just return
        if (!yyyyMmDdString) return "";

        // creates a js data object
        var parsedDate = new Date(yyyyMmDdString + "T00:00:00");

        // if date is invalid just return original string
        if (isNaN(parsedDate.getTime())) return yyyyMmDdString;

        // formats the data in the nice readable version
        return parsedDate.toLocaleDateString("en-AU", { 
            weekday: "short", 
            day: "numeric", 
            month: "short", 
            year: "numeric" 
        });
    }



    // takes booking statsus and returns coloured pill 
    function fnStatusBadge(status) {

        // makes status uppcase and returns nothing if missing
        var label = (status || "").toUpperCase();

        // base classes
        var classes = "px-2 py-0.5 rounded-full text-[10px] font-semibold border";
        
        // adds colours
        if (status === "paid")           
            classes += " bg-green-500/10 border-green-500/40 text-green-400";

        else if (status === "pending")   
            classes += " bg-yellow-500/10 border-yellow-500/40 text-yellow-300";

        else if (status === "reserved")  
            classes += " bg-yellow-500/10 border-yellow-500/40 text-yellow-300";

        else if (status === "cancelled") 
            classes += " bg-red-500/10 border-red-500/40 text-red-400";

        else if (status === "refunded")  
            classes += " bg-blue-500/10 border-blue-500/40 text-blue-400";
        
        else classes += " bg-ak-border border-ak-border text-ak-muted";

        return '<span class="' + classes + '">' + fnEscapeHtml(label) + '</span>';
    }



    // turns single digits to numbers with 0 in front of it
    function fnPad2(n) { return n < 10 ? "0" + n : "" + n; }



    // takes js date object and turns it into a string
    function fnFormatDateISO(dateObj) {                                                     
        return dateObj.getFullYear() + "-" + fnPad2(dateObj.getMonth() + 1) + "-" + fnPad2(dateObj.getDate());
    }



    // takes a date string and turns it into a js date objkect 
    function fnParseDateISO(yyyyMmDd) {
        var parts = yyyyMmDd.split("-");
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }



    // gets todays date
    function fnTodayLocal() {
        var d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }



    // adds log out functionality to any element with the data-admin-logout
    document.querySelectorAll("[data-admin-logout]").forEach(function (logoutButton) {

        // runs when the button is clicked
        logoutButton.addEventListener("click", async function () {

            // sends the logout request
            await fnPostJSON("/api/admin/auth/logout", {});

            // redirects to login page
            window.location.href = "/admin/login";
        });
    });


    // gets the login form
    var loginForm = document.getElementById("admin-login-form");

    // if the login exists run the code to handle login
    if (loginForm) {

        // runs when the login form is submitted
        loginForm.addEventListener("submit", async function (submitEvent) {

            // stops page from reloading
            submitEvent.preventDefault();

            // hides any previous error message
            var errorElement = loginForm.querySelector("[data-form-error]");
            if (errorElement) { errorElement.classList.add("hidden"); errorElement.textContent = ""; }


            // ensures both email and password have been entered
            var email = loginForm.email.value.trim();
            var password = loginForm.password.value;
            if (!email || !password) {
                if (errorElement) {
                    errorElement.textContent = "Please enter your email and password.";
                    errorElement.classList.remove("hidden");
                }
                return;
            }

            // send the login request to backend
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


    // month names array
    var MONTH_NAMES = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ];



    // draws the calendar grid for the booking page
    function fnRenderCalendarGrid(rootIds, state, opts) {

        // element that will show the month and year title
        var titleEl = document.getElementById(rootIds.titleId);

        // element that will contain actualday number
        var gridEl  = document.getElementById(rootIds.gridId);

        // previous month button
        var prevBtn = document.getElementById(rootIds.prevId);

        // next month button
        var nextBtn = document.getElementById(rootIds.nextId);

        // if either dont exist just ruturn
        if (!titleEl || !gridEl) return;

        // gets todays date from function above
        var today = fnTodayLocal();

        // calculates which month to display
        var firstOfView = new Date(today.getFullYear(), today.getMonth() + state.offset, 1);
        
        var viewYear  = firstOfView.getFullYear();
        
        var viewMonth = firstOfView.getMonth();
        
        // sets title to the month and then year
        titleEl.textContent = MONTH_NAMES[viewMonth] + " " + viewYear;

        // enable or disable prev and next button based off offset
        if (prevBtn) prevBtn.disabled = !opts.allowPrev(state.offset);
        if (nextBtn) nextBtn.disabled = !opts.allowNext(state.offset);

        // if displayinfoid was passed in options, then set text to it
        if (opts.displayInfoId) {
            var infoEl = document.getElementById(opts.displayInfoId);
            if (infoEl) infoEl.textContent = opts.displayInfoText || "";
        }

        gridEl.innerHTML = "";

        // gets first day in week and number of days in the month
        var firstDow    = new Date(viewYear, viewMonth, 1).getDay();
        var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        // creates blank cells until month starts
        for (var b = 0; b < firstDow; b++) {
            var blank = document.createElement("div");
            blank.className = "h-9";
            gridEl.appendChild(blank);
        }

        // creates cells for each day in the month
        for (var day = 1; day <= daysInMonth; day++) {
            var dayDate = new Date(viewYear, viewMonth, day);
            var dayIso  = fnFormatDateISO(dayDate);
            var cell    = document.createElement("button");
            cell.type = "button";
            cell.textContent = day;
            cell.setAttribute("data-date", dayIso);
            cell.className = "h-9 rounded-lg text-sm font-medium flex items-center justify-center transition-colors";
            opts.decorateCell(dayIso, dayDate, today, cell);
            gridEl.appendChild(cell);
        }
    }


    // tracks which month offset and which day is selected for the bookings calendar
    var bookingsCalState = { offset: 0, selectedIso: null };

    // how far back the admin can navigate
    var BOOKINGS_PAST_MONTHS = 12;

    // and how far forward
    var BOOKINGS_FUTURE_MONTHS = 6;



    // style each cell depending on whether it is selected, today, or a normal day
    function fnDecorateBookingsCell(dayIso, dayDate, today, cell) {

        // checks if this cell is the selected date
        var isSelected = bookingsCalState.selectedIso === dayIso;

        // checks if this cell is today
        var isToday    = dayDate.getTime() === today.getTime();

        // gets the base css classes already on the cell
        var baseClass  = cell.className;

        // selected day gets purple background
        if (isSelected) {
            cell.className = baseClass + " bg-ak-purple text-white";

        // today gets a dark background with purple on hover
        } else if (isToday) {
            cell.className = baseClass + " bg-ak-border text-white hover:bg-ak-purple cursor-pointer";

        // all other days are plain white with hover highlight
        } else {
            cell.className = baseClass + " text-white hover:bg-ak-border cursor-pointer";
        }

        // when clicked, mark this day as selected and load its bookings
        cell.addEventListener("click", function () {
            bookingsCalState.selectedIso = dayIso;
            fnRenderBookingsCalendar();
            fnLoadBookingsForDate(dayIso);
        });
    }



    // redraws the bookings calendar using the current state offset and selection
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



    // fetches all bookings for a given date from the server and renders them as hour cards
    async function fnLoadBookingsForDate(dateIso) {

        // grabs all the ui elements needed
        var loadingEl = document.getElementById("bk-hours-loading");
        var listEl    = document.getElementById("bk-hours-list");
        var emptyEl   = document.getElementById("bk-hours-empty");
        var bannerEl  = document.getElementById("bk-day-blocked-banner");
        var summaryEl = document.getElementById("bk-hour-summary");

        // show loading text while waiting
        loadingEl.textContent = "Loading…";
        loadingEl.classList.remove("hidden");
        listEl.classList.add("hidden");
        emptyEl.classList.add("hidden");
        bannerEl.classList.add("hidden");
        summaryEl.textContent = "";

        // asks the server for bookings on this date
        var result = await fnFetchJSON("/api/admin/bookings/by-date?date=" + encodeURIComponent(dateIso));

        // if request failed, show the error message instead
        if (!result.ok || !result.data.success) {
            loadingEl.textContent = (result.data && result.data.error) || "Could not load bookings for this date.";
            return;
        }
        
        var data = result.data.data;

        // if the whole day is blocked, show the blocked banner
        if (data.is_day_blocked) {
            document.getElementById("bk-day-blocked-reason").textContent = data.blocked_reason || "Blocked by admin.";
            bannerEl.classList.remove("hidden");
        }

        var hours = data.hours || [];

        // closed weekday or no opening hours
        if (hours.length === 0 && !data.is_day_blocked) {
            loadingEl.textContent = "Closed on this weekday (no opening hours set).";
            return;
        }

        // running totals across all hours for the day summary line
        var totalDriversDay = 0;
        var totalBookingsDay = 0;
        listEl.innerHTML = "";

        // loop through each hour slot and build a card for it
        hours.forEach(function (hour) {
            totalDriversDay += hour.drivers_total;

            // only count / show paid bookings on this page
            var paidBookings = hour.bookings.filter(function (b) { return b.payment_status === "paid"; });
            totalBookingsDay += paidBookings.length;

            // header row showing the hour label and how full the slot is
            var headerHtml =
                '<div class="flex items-center justify-between px-4 py-2 bg-ak-border/40">' +
                    '<p class="text-white text-sm font-semibold">' + fnEscapeHtml(hour.label) + '</p>' +
                    '<p class="text-ak-muted text-xs">' + hour.drivers_total + ' / ' + hour.max_capacity + ' drivers</p>' +
                '</div>';

            var bookingsHtml = "";

            // if no paid bookings in this hour, show a placeholder message
            if (paidBookings.length === 0) {
                bookingsHtml = '<div class="px-4 py-3 text-ak-muted text-xs">No paid bookings.</div>';
            } else {

                // build a row for each paid booking
                bookingsHtml = paidBookings.map(function (booking) {
                    var customerName  = "(unknown)";
                    var customerEmail = "";
                    var creatorId     = "";

                    // pull name and email from the creator object if it exists
                    if (booking.creator) {
                        customerName = (booking.creator.first_name + " " + booking.creator.last_name).trim();
                        if (!customerName) { customerName = booking.creator.email || "(unknown)"; }
                        customerEmail = booking.creator.email || "";
                        creatorId     = booking.creator.id   || "";
                    }

                    // returns the html row with name, email, driver count, status badge, and action buttons
                    return '<div class="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">' +
                        '<div class="min-w-0">' +
                            '<p class="text-white text-sm font-medium truncate">' + fnEscapeHtml(customerName) + '</p>' +
                            '<p class="text-ak-muted text-xs truncate">' + fnEscapeHtml(customerEmail) + '</p>' +
                        '</div>' +
                        '<div class="flex items-center gap-3 shrink-0">' +
                            '<p class="text-ak-muted text-xs"><span class="text-white">' + booking.adult_count + 'A + ' + booking.junior_count + 'J</span> &middot; ' + fnEscapeHtml(booking.package_label) + '</p>' +
                            fnStatusBadge(booking.payment_status) +
                            '<button data-action="view"   data-id="' + fnEscapeHtml(booking.id) + '" data-creator-id="' + fnEscapeHtml(creatorId) + '" class="text-xs text-white border border-ak-border hover:border-ak-purple px-2 py-1 rounded-full transition-colors">View Customer</button>' +
                            '<button data-action="cancel" data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-red-400 border border-red-500/40 hover:bg-red-500 hover:text-white px-2 py-1 rounded-full transition-colors">Cancel</button>' +
                            '<button data-action="refund" data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-blue-400 border border-blue-500/40 hover:bg-blue-500 hover:text-white px-2 py-1 rounded-full transition-colors">Refund</button>' +
                        '</div>' +
                    '</div>';
                }).join('<div class="border-t border-ak-border"></div>');
            }

            // creates the card element and puts the header and bookings rows inside it
            var card = document.createElement("div");
            card.className = "bg-ak-bg/40 border border-ak-border rounded-lg overflow-hidden";
            card.innerHTML = headerHtml + bookingsHtml;
            listEl.appendChild(card);
        });

        // show the day summary and reveal the list
        summaryEl.textContent = totalBookingsDay + " bookings, " + totalDriversDay + " drivers";
        loadingEl.classList.add("hidden");
        listEl.classList.remove("hidden");
    }



    // handles clicking view, cancel, or refund on a booking row
    async function fnHandleBookingAction(action, bookingId, creatorId) {

        // view just navigates to the customer page
        if (action === "view") {
            // navigate to the customer profile page
            if (creatorId) { window.location.href = "/admin/customers/" + creatorId; }
            return;
        }

        // cancel asks for confirmation then sends the cancel request
        if (action === "cancel") {
            if (!confirm("Cancel this booking? This will free up the slot capacity. This cannot be undone.")) return;
            var cancelResult = await fnPostJSON("/api/admin/bookings/" + encodeURIComponent(bookingId) + "/cancel", {});
            if (!cancelResult.ok || !cancelResult.data.success) {
                alert((cancelResult.data && cancelResult.data.error) || "Could not cancel booking.");
                return;
            }

            // reload the selected day to reflect the cancellation
            if (bookingsCalState.selectedIso) fnLoadBookingsForDate(bookingsCalState.selectedIso);
            return;
        }

        // refund asks for confirmation then sends the refund request to stripe
        if (action === "refund") {
            if (!confirm("Refund this booking? This issues a Stripe refund and frees the slot capacity.")) return;
            var refundResult = await fnPostJSON("/api/admin/bookings/" + encodeURIComponent(bookingId) + "/refund", {});
            if (!refundResult.ok || !refundResult.data.success) {
                alert((refundResult.data && refundResult.data.error) || "Could not refund booking.");
                return;
            }

            // reload the selected day to reflect the refund
            if (bookingsCalState.selectedIso) fnLoadBookingsForDate(bookingsCalState.selectedIso);
            return;
        }
    }


    // GET /api/admin/bookings/<id> and render the modal
    async function fnOpenBookingDetail(bookingId) {

        // fetches the full booking detail from the server
        var result = await fnFetchJSON("/api/admin/bookings/" + encodeURIComponent(bookingId));
        if (!result.ok || !result.data.success) {
            alert("Could not load booking detail.");
            return;
        }
        var booking = result.data.data;

        // puts the booking reference number in the modal title
        document.getElementById("booking-detail-ref").textContent = "Ref " + booking.ref;

        // builds a list of linked users, or shows "(none)" if there are none
        var linkedUsersHtml = "(none)";
        if (booking.linked_users && booking.linked_users.length > 0) {
            linkedUsersHtml = "<ul class='space-y-1'>" + booking.linked_users.map(function (u) {
                var name = (u.first_name + " " + u.last_name).trim() || u.email;
                return "<li>" + fnEscapeHtml(name) + " &middot; <span class='text-ak-muted'>" + fnEscapeHtml(u.email) + "</span></li>";
            }).join("") + "</ul>";
        }

        // fills the modal body with all booking info in a two-column grid
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

        // shows the modal
        document.getElementById("booking-detail-modal").classList.remove("hidden");
    }



    // wires up all the buttons and forms on the bookings page
    function fnWireBookingsPage() {

        // previous month button goes back one month
        document.getElementById("bk-cal-prev").addEventListener("click", function () {
            if (bookingsCalState.offset > -BOOKINGS_PAST_MONTHS) { bookingsCalState.offset -= 1; fnRenderBookingsCalendar(); }
        });

        // next month button goes forward one month
        document.getElementById("bk-cal-next").addEventListener("click", function () {
            if (bookingsCalState.offset <  BOOKINGS_FUTURE_MONTHS) { bookingsCalState.offset += 1; fnRenderBookingsCalendar(); }
        });

        // listens for clicks on action buttons inside the bookings list
        document.getElementById("bk-hours-list").addEventListener("click", function (clickEvent) {
            var target = clickEvent.target.closest("button[data-action]");
            if (!target) return;

            // passes the action, booking id, and creator id to the handler
            fnHandleBookingAction(
                target.getAttribute("data-action"),
                target.getAttribute("data-id"),
                target.getAttribute("data-creator-id")
            );
        });

        // close buttons for the booking detail modal
        document.querySelectorAll("[data-close-detail]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.getElementById("booking-detail-modal").classList.add("hidden");
            });
        });

        // close buttons for the manual booking modal
        document.querySelectorAll("[data-close-manual]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                document.getElementById("manual-booking-modal").classList.add("hidden");
            });
        });

        // open manual booking modal button, pre-fills the date field if a day is selected
        document.getElementById("btn-open-manual-booking").addEventListener("click", function () {
            fnClearError("manual-booking-error");
            document.getElementById("manual-booking-form").reset();
            document.getElementById("m-adults").value = 1;
            document.getElementById("m-juniors").value = 0;
            document.getElementById("m-extra").value = 0;
            if (bookingsCalState.selectedIso) {
                document.getElementById("m-date").value = bookingsCalState.selectedIso;
            }
            document.getElementById("manual-booking-modal").classList.remove("hidden");
        });

        // handles submitting the manual booking form
        document.getElementById("manual-booking-form").addEventListener("submit", async function (submitEvent) {

            // stops page from reloading
            submitEvent.preventDefault();
            fnClearError("manual-booking-error");

            // collects form values into a payload object
            var payload = {
                customer_email: document.getElementById("m-customer-email").value.trim(),
                date:           document.getElementById("m-date").value,
                time_slot:      document.getElementById("m-time").value,
                adult_count:    document.getElementById("m-adults").value,
                junior_count:   document.getElementById("m-juniors").value,
                package_id:     document.getElementById("m-package").value,
                extra_rides:    document.getElementById("m-extra").value,
            };

            // sends the create request to the server
            var result = await fnPostJSON("/api/admin/bookings/create", payload);
            if (!result.ok || !result.data.success) {
                fnShowError("manual-booking-error", (result.data && result.data.error) || "Could not create booking.");
                return;
            }

            // hides the modal after a successful booking
            document.getElementById("manual-booking-modal").classList.add("hidden");

            // jump the calendar to the newly created booking's date and refresh the hour view
            if (payload.date) {
                bookingsCalState.selectedIso = payload.date;
                var today = fnTodayLocal();
                var picked = fnParseDateISO(payload.date);

                // calculates how many months away the new booking is and sets the offset
                bookingsCalState.offset = (picked.getFullYear() - today.getFullYear()) * 12 + (picked.getMonth() - today.getMonth());
                fnRenderBookingsCalendar();
                fnLoadBookingsForDate(payload.date);
            }
        });
    }



    // starts the bookings page by selecting today, wiring buttons, and loading todays bookings
    function fnInitBookingsPage() {
        var todayIso = fnFormatDateISO(fnTodayLocal());
        bookingsCalState.selectedIso = todayIso;
        fnWireBookingsPage();
        fnRenderBookingsCalendar();
        fnLoadBookingsForDate(todayIso);
    }


    // searches for customers by name or email and shows the results in the table
    async function fnRunCustomerSearch(queryText) {

        // grabs the ui elements for the search results area
        var loading = document.getElementById("cust-loading");
        var wrapper = document.getElementById("cust-table-wrapper");
        var tbody   = document.getElementById("cust-tbody");
        var empty   = document.getElementById("cust-empty");
        var emptyState = document.getElementById("cust-empty-state");

        // hides the empty state and shows a loading spinner
        emptyState.classList.add("hidden");
        loading.classList.remove("hidden");
        wrapper.classList.add("hidden");

        // asks the server to search for customers matching the query
        var result = await fnFetchJSON("/api/admin/customers?q=" + encodeURIComponent(queryText));
        loading.classList.add("hidden");

        // if the request failed, show an error row in the table
        if (!result.ok || !result.data.success) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-3 py-4 text-red-400 text-sm">' + fnEscapeHtml((result.data && result.data.error) || "Could not load customers.") + '</td></tr>';
            wrapper.classList.remove("hidden");
            return;
        }
        var customers = result.data.data.customers || [];
        tbody.innerHTML = "";

        // if no results, show the empty message
        if (customers.length === 0) {
            empty.classList.remove("hidden");
        } else {
            empty.classList.add("hidden");

            // build a table row for each customer result
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

    // fetches and renders a popup modal with the full profile for a single customer
    async function fnOpenCustomerProfile(customerId) {

        // fetches the customer data from the server
        var result = await fnFetchJSON("/api/admin/customers/" + encodeURIComponent(customerId));
        if (!result.ok || !result.data.success) {
            alert("Could not load customer.");
            return;
        }
        var customer = result.data.data;

        // puts the customer name and email in the modal header
        var fullName = (customer.first_name + " " + customer.last_name).trim() || "(no name)";
        document.getElementById("cust-profile-name").textContent = fullName;
        document.getElementById("cust-profile-email").textContent = customer.email || "";

        // builds a list of the customer's minors with waiver status badges
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

        // builds a table of the customer's bookings
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

        // shows a green or red waiver badge depending on whether the adult waiver is signed
        var waiverBadge = customer.waiver_accepted ? '<span class="text-green-400">signed</span>' : '<span class="text-red-400">missing</span>';

        // fills the modal body with all the customer's personal details, minors, and bookings
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

        // shows the modal
        document.getElementById("cust-profile-modal").classList.remove("hidden");
    }



    // wires up the search box and results table on the customers page
    function fnWireCustomersPage() {

        // runs the search using the current value in the search input
        function fnDoSearch() {
            var queryText = document.getElementById("cust-search").value.trim();

            // if the search box is empty, hide results and show the empty state prompt
            if (!queryText) {
                document.getElementById("cust-table-wrapper").classList.add("hidden");
                document.getElementById("cust-empty-state").classList.remove("hidden");
                return;
            }
            fnRunCustomerSearch(queryText);
        }

        // search button triggers the search
        document.getElementById("btn-cust-search").addEventListener("click", fnDoSearch);

        // pressing enter in the search box also triggers the search
        document.getElementById("cust-search").addEventListener("keydown", function (keyEvent) {
            if (keyEvent.key === "Enter") fnDoSearch();
        });

        // clicking a row navigates to the customer detail page
        document.getElementById("cust-tbody").addEventListener("click", function (clickEvent) {
            var row = clickEvent.target.closest("tr[data-customer-id]");
            if (!row) return;
            window.location.href = "/admin/customers/" + row.getAttribute("data-customer-id");
        });
    }



    // loads the current settings from the server and fills the settings form
    async function fnLoadSettings() {
        var loading = document.getElementById("settings-loading");
        var form = document.getElementById("settings-form");

        // shows loading text while waiting
        loading.classList.remove("hidden");
        form.classList.add("hidden");

        // fetches the settings from the server
        var result = await fnFetchJSON("/api/admin/settings");
        loading.classList.add("hidden");

        // if request failed, keep the loading element visible with an error message
        if (!result.ok || !result.data.success) {
            loading.textContent = "Could not load settings.";
            loading.classList.remove("hidden");
            return;
        }
        var settings = result.data.data;

        // fills in the capacity field with the current setting
        document.getElementById("settings-capacity").value = settings.max_capacity_per_slot || 50;
        form.classList.remove("hidden");
    }



    // wires up the settings form to save changes when submitted
    function fnWireSettingsForm() {
        document.getElementById("settings-form").addEventListener("submit", async function (submitEvent) {

            // stops the page from reloading
            submitEvent.preventDefault();
            fnClearError("settings-error");
            document.getElementById("settings-success").classList.add("hidden");

            // collects the form values into a payload
            var payload = {
                max_capacity_per_slot: parseInt(document.getElementById("settings-capacity").value, 10) || 50,
            };

            // sends a PUT request to save the new settings
            var result = await fnFetchJSON("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            // shows error or success message depending on the result
            if (!result.ok || !result.data.success) {
                fnShowError("settings-error", (result.data && result.data.error) || "Could not save settings.");
                return;
            }
            document.getElementById("settings-success").classList.remove("hidden");
        });
    }


    // tracks which month and day is selected on the settings calendar, plus which days are blocked
    var settingsBlockState = {
        offset: 0,
        selectedIso: null,
        isDayBlocked: false,
        blockedDateSet: {},
    };

    // admin shouldn't block past dates
    var SET_PAST_MONTHS   = 0;
    // how many months ahead the admin can navigate to block days
    var SET_FUTURE_MONTHS = 12;



    // pulls the visible window of blocked days so the calendar can tint them red
    async function fnRefreshSettingsBlockedDays() {

        // calculates the date range to fetch: from today to the furthest month visible
        var today = fnTodayLocal();
        var fromIso = fnFormatDateISO(today);
        var toDate = new Date(today.getFullYear(), today.getMonth() + SET_FUTURE_MONTHS + 1, 0);
        var toIso = fnFormatDateISO(toDate);

        // fetches all blocked days in that range
        var result = await fnFetchJSON("/api/admin/days?from=" + fromIso + "&to=" + toIso);
        settingsBlockState.blockedDateSet = {};

        // stores each blocked date in the state object so the calendar can colour them
        if (result.ok && result.data && result.data.success) {
            (result.data.data.days || []).forEach(function (d) {
                if (d.is_blocked) settingsBlockState.blockedDateSet[d.date] = d.blocked_reason || "";
            });
        }
    }



    // styles each cell on the settings calendar based on its state
    function fnDecorateSettingsCalCell(dayIso, dayDate, today, cell) {

        // checks what state this cell is in
        var isPast     = dayDate < today;
        var isSelected = settingsBlockState.selectedIso === dayIso;
        var isToday    = dayDate.getTime() === today.getTime();
        var isBlocked  = Object.prototype.hasOwnProperty.call(settingsBlockState.blockedDateSet, dayIso);
        var baseClass  = cell.className;

        // past dates are non-interactive
        if (isPast) {
            cell.className = baseClass + " text-ak-hint cursor-not-allowed opacity-40";
            cell.disabled = true;
            return;
        }

        // selected day gets purple, with a red ring if it is also blocked
        if (isSelected) {
            cell.className = baseClass + " bg-ak-purple text-white" + (isBlocked ? " ring-2 ring-red-500/70" : "");

        // blocked days get a red tint and show a tooltip with the reason
        } else if (isBlocked) {
            cell.className = baseClass + " bg-red-500/20 border border-red-500/60 text-red-300 hover:bg-red-500/30 cursor-pointer";
            cell.title = settingsBlockState.blockedDateSet[dayIso] || "Blocked";

        // today gets a dark background
        } else if (isToday) {
            cell.className = baseClass + " bg-ak-border text-white hover:bg-ak-purple cursor-pointer";

        // all other days are plain white
        } else {
            cell.className = baseClass + " text-white hover:bg-ak-border cursor-pointer";
        }

        // clicking a day selects it and loads its hours
        cell.addEventListener("click", function () {
            settingsBlockState.selectedIso = dayIso;
            fnRenderSettingsCalendar();
            fnLoadSettingsHoursForDate(dayIso);
        });
    }



    // redraws the settings calendar using the current state
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


    // refreshes the button label and colour to match the current selection
    function fnUpdateDayBlockButton() {
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

    // fetches the hours for a selected day and renders them as cards with block/unblock buttons
    async function fnLoadSettingsHoursForDate(dateIso) {

        // grabs all the ui elements needed
        var loadingEl = document.getElementById("set-hours-loading");
        var listEl    = document.getElementById("set-hours-list");
        var emptyEl   = document.getElementById("set-hours-empty");
        var bannerEl  = document.getElementById("set-day-blocked-banner");
        var summaryEl = document.getElementById("set-hour-summary");

        // shows loading text and hides everything else while waiting
        loadingEl.textContent = "Loading…";
        loadingEl.classList.remove("hidden");
        listEl.classList.add("hidden");
        emptyEl.classList.add("hidden");
        bannerEl.classList.add("hidden");
        summaryEl.textContent = "";

        // fetches the hours data from the server
        var result = await fnFetchJSON("/api/admin/bookings/by-date?date=" + encodeURIComponent(dateIso));

        // if it failed, show error and reset the block button
        if (!result.ok || !result.data.success) {
            loadingEl.textContent = (result.data && result.data.error) || "Could not load hours for this date.";
            settingsBlockState.isDayBlocked = false;
            fnUpdateDayBlockButton();
            return;
        }
        var data = result.data.data;

        // updates the state and refreshes the block/unblock button label
        settingsBlockState.isDayBlocked = !!data.is_day_blocked;
        fnUpdateDayBlockButton();

        // if the whole day is blocked, show the blocked banner with the reason
        if (data.is_day_blocked) {
            document.getElementById("set-day-blocked-reason").textContent = data.blocked_reason || "Blocked by admin.";
            bannerEl.classList.remove("hidden");
        }

        var hours = data.hours || [];

        // if no hours, show a message for a closed day or leave blank if just blocked
        if (hours.length === 0) {
            loadingEl.textContent = data.is_day_blocked ? "" : "Closed on this weekday (no opening hours set).";
            return;
        }

        var totalBlockedHours = 0;
        listEl.innerHTML = "";

        // build a card for each hour slot
        hours.forEach(function (hour) {

            // count how many hours are blocked for the summary line
            if (hour.is_blocked) totalBlockedHours += 1;

            // sets the block button label and style depending on the current state
            var blockBtnLabel = hour.is_blocked ? "Unblock hour" : "Block hour";
            var blockBtnClass = hour.is_blocked
                ? "text-xs text-red-300 border border-red-500/60 bg-red-500/10 hover:bg-red-500 hover:text-white px-3 py-1 rounded-full transition-colors"
                : "text-xs text-white border border-ak-border hover:border-ak-purple px-3 py-1 rounded-full transition-colors";

            // header row with the hour label and the block/unblock button
            var headerHtml =
                '<div class="flex items-center justify-between px-4 py-2 bg-ak-border/40">' +
                    '<p class="text-white text-sm font-semibold">' + fnEscapeHtml(hour.label) + '</p>' +
                    '<button type="button" data-set-hour-block="' + hour.hour + '" data-currently-blocked="' + (hour.is_blocked ? "1" : "0") + '" class="' + blockBtnClass + '">' + blockBtnLabel + '</button>' +
                '</div>';

            var bookingsHtml = "";

            // if no bookings in this hour, show a placeholder
            if (hour.bookings.length === 0) {
                bookingsHtml = '<div class="px-4 py-3 text-ak-muted text-xs">No bookings.</div>';
            } else {

                // build a row for each booking showing the customer name and driver count
                bookingsHtml = hour.bookings.map(function (booking) {
                    var customerName = "(unknown)";
                    var customerEmail = "";

                    // pulls name and email from the creator object if available
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

            // creates the card element, adds a red ring if the hour is blocked
            var card = document.createElement("div");
            card.className = "bg-ak-bg/40 border border-ak-border rounded-lg overflow-hidden" + (hour.is_blocked ? " ring-1 ring-red-500/40" : "");
            card.innerHTML = headerHtml + bookingsHtml;
            listEl.appendChild(card);
        });

        // shows how many hours are blocked out of the total
        summaryEl.textContent = totalBlockedHours + " of " + hours.length + " hours blocked";
        loadingEl.classList.add("hidden");
        listEl.classList.remove("hidden");
    }

    // toggles the entire selected day as blocked or unblocked
    async function fnToggleSettingsDayBlock() {

        // does nothing if no day is selected
        if (!settingsBlockState.selectedIso) return;
        var dateIso = settingsBlockState.selectedIso;

        // if already blocked, ask to unblock it
        if (settingsBlockState.isDayBlocked) {
            if (!confirm("Unblock " + fnFormatDateNice(dateIso) + " for bookings?")) return;
            var unblockResult = await fnPostJSON("/api/admin/days/unblock", { date: dateIso });
            if (!unblockResult.ok || !unblockResult.data.success) {
                alert((unblockResult.data && unblockResult.data.error) || "Could not unblock the date.");
                return;
            }

        // otherwise ask for an optional reason and block it
        } else {
            var reason = prompt("Optional reason for blocking " + fnFormatDateNice(dateIso) + ":");
            if (reason === null) return;
            var blockResult = await fnPostJSON("/api/admin/days/block", { date: dateIso, reason: reason });
            if (!blockResult.ok || !blockResult.data.success) {
                alert((blockResult.data && blockResult.data.error) || "Could not block the date.");
                return;
            }
        }

        // refreshes the blocked day set so the calendar updates its colours
        await fnRefreshSettingsBlockedDays();
        fnRenderSettingsCalendar();

        // reload to refresh banner + button label
        await fnLoadSettingsHoursForDate(dateIso);
    }



    // toggles a single hour slot as blocked or unblocked on the selected day
    async function fnToggleSettingsHourBlock(hour, currentlyBlocked) {

        // does nothing if no day is selected
        if (!settingsBlockState.selectedIso) return;
        var dateIso = settingsBlockState.selectedIso;

        // if already blocked, ask to unblock it
        if (currentlyBlocked) {
            if (!confirm("Unblock this hour?")) return;
            var unblockResult = await fnPostJSON("/api/admin/slots/unblock", { date: dateIso, hour: hour });
            if (!unblockResult.ok || !unblockResult.data.success) {
                alert((unblockResult.data && unblockResult.data.error) || "Could not unblock the hour.");
                return;
            }

        // otherwise ask for an optional reason and block it
        } else {
            var reason = prompt("Optional reason for blocking this hour:");
            if (reason === null) return;
            var blockResult = await fnPostJSON("/api/admin/slots/block", { date: dateIso, hour: hour, reason: reason });
            if (!blockResult.ok || !blockResult.data.success) {
                alert((blockResult.data && blockResult.data.error) || "Could not block the hour.");
                return;
            }
        }

        // refresh the hour list to update button labels and ring colours
        await fnLoadSettingsHoursForDate(dateIso);
    }



    // wires up all the buttons in the settings block/unblock section
    function fnWireSettingsBlockSection() {

        // previous month button goes back one month
        document.getElementById("set-cal-prev").addEventListener("click", function () {
            if (settingsBlockState.offset > SET_PAST_MONTHS) { settingsBlockState.offset -= 1; fnRenderSettingsCalendar(); }
        });

        // next month button goes forward one month
        document.getElementById("set-cal-next").addEventListener("click", function () {
            if (settingsBlockState.offset < SET_FUTURE_MONTHS) { settingsBlockState.offset += 1; fnRenderSettingsCalendar(); }
        });

        // block/unblock day button
        document.getElementById("btn-set-block-day").addEventListener("click", fnToggleSettingsDayBlock);

        // listens for clicks on block/unblock buttons inside the hours list
        document.getElementById("set-hours-list").addEventListener("click", function (clickEvent) {
            var target = clickEvent.target.closest("button[data-set-hour-block]");
            if (!target) return;

            // reads which hour and whether it is currently blocked from the button's data attributes
            var hour = parseInt(target.getAttribute("data-set-hour-block"), 10);
            var currentlyBlocked = target.getAttribute("data-currently-blocked") === "1";
            fnToggleSettingsHourBlock(hour, currentlyBlocked);
        });
    }



    // starts the settings page by wiring everything up, loading settings, and showing todays hours
    async function fnInitSettingsPage() {
        fnWireSettingsForm();
        fnWireSettingsBlockSection();
        await fnLoadSettings();
        await fnRefreshSettingsBlockedDays();

        var todayIso = fnFormatDateISO(fnTodayLocal());

        // start on today so admin sees something immediately
        settingsBlockState.selectedIso = todayIso;
        fnRenderSettingsCalendar();
        fnUpdateDayBlockButton();
        fnLoadSettingsHoursForDate(todayIso);
    }


    
    // customer detail page - loads and renders a full customer profile
    async function fnLoadCustomerDetail(userId) {

        // grabs the loading, error, and body elements
        var loadingEl = document.getElementById("cd-loading");
        var errorEl   = document.getElementById("cd-error");
        var bodyEl    = document.getElementById("cd-body");

        // fetches the customer data from the server
        var result = await fnFetchJSON("/api/admin/customers/" + encodeURIComponent(userId));

        // if request failed, hide loading and show the error message
        if (!result.ok || !result.data.success) {
            if (loadingEl) { loadingEl.classList.add("hidden"); }
            if (errorEl) {
                errorEl.textContent = (result.data && result.data.error) || "Could not load customer.";
                errorEl.classList.remove("hidden");
            }
            return;
        }

        var customer = result.data.data;

        // update the header with the customer's name and email
        var nameEl  = document.getElementById("cd-name");
        var emailEl = document.getElementById("cd-email");
        var fullName = (customer.first_name + " " + customer.last_name).trim();
        if (nameEl)  { nameEl.textContent  = fullName || "(no name)"; }
        if (emailEl) { emailEl.textContent = customer.email || ""; }

        // renders each section of the customer profile
        fnRenderCustomerDetails(customer);
        fnRenderCustomerWaiver(customer);
        fnRenderCustomerMinors(customer.minors || []);
        fnRenderCustomerBookings(customer.bookings || [], userId);

        // hides the loading spinner and shows the body
        if (loadingEl) { loadingEl.classList.add("hidden"); }
        if (bodyEl)    { bodyEl.classList.remove("hidden"); }
    }



    // renders the personal details grid section of the customer detail page
    function fnRenderCustomerDetails(customer) {
        var el = document.getElementById("cd-details");
        if (!el) return;

        // list of fields to display as label-value pairs
        var fields = [
            ["Phone",        customer.phone   || "-"],
            ["Date of Birth", customer.dob    || "-"],
            ["Gender",       customer.gender  || "-"],
            ["Member Since", customer.created_at ? customer.created_at.substring(0, 10) : "-"],
            ["Address",      customer.address || "-"],
        ];

        // builds the html grid from the fields array
        el.innerHTML = fields.map(function (f) {
            return '<div><p class="text-ak-muted text-xs mb-0.5">' + fnEscapeHtml(f[0]) + '</p>' +
                   '<p class="text-white">' + fnEscapeHtml(f[1]) + '</p></div>';
        }).join("");
    }



    // renders the waiver status section on the customer detail page
    function fnRenderCustomerWaiver(customer) {
        var el = document.getElementById("cd-waiver");
        if (!el) return;

        // shows green "signed" with the date, or red "not signed" if unsigned
        if (customer.waiver_accepted) {
            var signedAt = customer.waiver_accepted_at
                ? new Date(customer.waiver_accepted_at).toLocaleDateString("en-AU") : "";
            el.innerHTML = '<span class="text-green-400 font-medium">Signed</span>' +
                (signedAt ? '<span class="text-ak-muted text-xs ml-2">on ' + fnEscapeHtml(signedAt) + '</span>' : '');
        } else {
            el.innerHTML = '<span class="text-red-400 font-medium">Not signed</span>';
        }
    }



    // renders the minors list section on the customer detail page
    function fnRenderCustomerMinors(minors) {
        var el = document.getElementById("cd-minors");
        if (!el) return;

        // if no minors, show a placeholder message
        if (!minors.length) {
            el.innerHTML = '<p class="text-ak-muted text-sm">No minors registered.</p>';
            return;
        }

        // builds a card for each minor with their name, age, and waiver status
        el.innerHTML = '<div class="space-y-2">' + minors.map(function (m) {
            var waiverHtml = m.waiver_accepted
                ? '<span class="text-green-400 text-xs font-medium">Waiver signed</span>'
                : '<span class="text-red-400 text-xs font-medium">Waiver missing</span>';
            return '<div class="flex items-center justify-between bg-ak-bg/40 border border-ak-border rounded-lg px-4 py-3">' +
                '<div>' +
                    '<p class="text-white text-sm font-medium">' + fnEscapeHtml(m.first_name + " " + m.last_name) + '</p>' +
                    '<p class="text-ak-muted text-xs">Age ' + (m.age !== null ? m.age : "-") + '</p>' +
                '</div>' +
                waiverHtml +
            '</div>';
        }).join("") + '</div>';
    }



    // renders the bookings list on the customer detail page with cancel and refund buttons
    function fnRenderCustomerBookings(bookings, userId) {
        var el = document.getElementById("cd-bookings");
        if (!el) return;

        // if no bookings, show a placeholder message
        if (!bookings.length) {
            el.innerHTML = '<p class="text-ak-muted text-sm">No bookings found.</p>';
            return;
        }

        el.innerHTML = "";

        // builds a card for each booking
        bookings.forEach(function (booking) {
            var card = document.createElement("div");
            card.className = "bg-ak-bg/40 border border-ak-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 justify-between";

            // only show refund button if the booking is paid
            var actionBtns = "";
            if (booking.payment_status === "paid") {
                actionBtns +=
                    '<button data-action="refund" data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-blue-400 border border-blue-500/40 hover:bg-blue-500 hover:text-white px-2 py-1 rounded-full transition-colors">Refund</button>';
            }

            // only show cancel button if not already cancelled or refunded
            if (booking.payment_status !== "cancelled" && booking.payment_status !== "refunded") {
                actionBtns +=
                    '<button data-action="cancel" data-id="' + fnEscapeHtml(booking.id) + '" class="text-xs text-red-400 border border-red-500/40 hover:bg-red-500 hover:text-white px-2 py-1 rounded-full transition-colors">Cancel</button>';
            }

            // fills the card with the booking date, time, drivers, total, status, and action buttons
            card.innerHTML =
                '<div class="min-w-0">' +
                    '<p class="text-white text-sm font-medium">' + fnEscapeHtml(fnFormatDateNice(booking.date)) + ' &middot; ' + fnEscapeHtml(booking.time_label) + '</p>' +
                    '<p class="text-ak-muted text-xs">' + booking.adult_count + 'A + ' + booking.junior_count + 'J &middot; ' + fnEscapeHtml(booking.package_label) + ' &middot; ' + fnFormatCents(booking.total_amount) + '</p>' +
                '</div>' +
                '<div class="flex items-center gap-2 shrink-0">' + fnStatusBadge(booking.payment_status) + actionBtns + '</div>';
            el.appendChild(card);
        });

        // wire cancel / refund buttons
        el.addEventListener("click", async function (e) {
            var target = e.target.closest("button[data-action]");
            if (!target) return;
            var action    = target.getAttribute("data-action");
            var bookingId = target.getAttribute("data-id");

            // cancel asks for confirmation then sends the request
            if (action === "cancel") {
                if (!confirm("Cancel this booking? This frees the slot capacity.")) return;
                var res = await fnPostJSON("/api/admin/bookings/" + encodeURIComponent(bookingId) + "/cancel", {});
                if (!res.ok || !res.data.success) { alert((res.data && res.data.error) || "Could not cancel."); return; }

            // refund asks for confirmation then sends the stripe refund request
            } else if (action === "refund") {
                if (!confirm("Refund this booking? This issues a Stripe refund.")) return;
                var res = await fnPostJSON("/api/admin/bookings/" + encodeURIComponent(bookingId) + "/refund", {});
                if (!res.ok || !res.data.success) { alert((res.data && res.data.error) || "Could not refund."); return; }
            }

            // reload the page data to reflect the change
            fnLoadCustomerDetail(userId);
        });
    }



    // entry point for the customer detail page - reads the user id from the page and loads their profile
    function fnInitCustomerDetailPage() {
        var root = document.getElementById("customer-detail-root");
        if (!root) return;

        // gets the user id stored in the root element's data attribute
        var userId = root.getAttribute("data-user-id");
        if (!userId) return;
        fnLoadCustomerDetail(userId);
    }


    // reads the current url path and runs the right init function for the page
    var currentPath = window.location.pathname.replace(/\/$/, "");
    if (currentPath === "/admin/bookings")                             { fnInitBookingsPage(); }
    else if (currentPath === "/admin/customers")                       { fnWireCustomersPage(); }
    else if (currentPath === "/admin/settings")                        { fnInitSettingsPage(); }
    else if (currentPath.startsWith("/admin/customers/"))              { fnInitCustomerDetailPage(); }
})();
