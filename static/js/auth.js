(function () {
    "use strict";

    function showError(form, message) {
        const el = form.querySelector("[data-form-error]");
        if (!el) return;
        el.textContent = message;
        el.classList.remove("hidden");
    }

    function clearError(form) {
        const el = form.querySelector("[data-form-error]");
        if (!el) return;
        el.textContent = "";
        el.classList.add("hidden");
    }

    async function postJSON(url, body) {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            credentials: "same-origin"
        });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        return { ok: res.ok, status: res.status, data: data };
    }

    function ageFromDob(dobStr) {
        const dob = new Date(dobStr);
        if (isNaN(dob.getTime())) return null;
        const now = new Date();
        let age = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
        return age;
    }

    // ---------- Login ----------
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            clearError(loginForm);

            const email = loginForm.email.value.trim();
            const password = loginForm.password.value;

            if (!email || !password) {
                showError(loginForm, "Please enter your email and password.");
                return;
            }

            const result = await postJSON("/api/auth/login", { email, password });
            if (result.data && result.data.success) {
                window.location.href = result.data.data.redirect || "/dashboard";
            } else {
                const msg = (result.data && result.data.error) || "Something went wrong. Please try again.";
                showError(loginForm, msg);
            }
        });
    }

    // ---------- Register ----------
    const registerForm = document.getElementById("register-form");
    if (registerForm) {
        registerForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            clearError(registerForm);

            const f = registerForm;
            const password = f.password.value;
            const confirm = f.confirm_password.value;

            if (password !== confirm) {
                showError(registerForm, "Passwords do not match.");
                return;
            }

            const age = ageFromDob(f.dob.value);
            if (age === null) {
                showError(registerForm, "Please enter a valid date of birth.");
                return;
            }
            if (age < 18) {
                showError(registerForm, "You must be 18 or over to register.");
                return;
            }

            const payload = {
                first_name: f.first_name.value.trim(),
                last_name: f.last_name.value.trim(),
                gender: f.gender.value,
                dob: f.dob.value,
                address: f.address.value.trim(),
                phone: f.phone.value.trim(),
                email: f.email.value.trim(),
                password: password
            };

            const result = await postJSON("/api/auth/register", payload);
            if (result.data && result.data.success) {
                window.location.href = result.data.data.redirect || "/dashboard";
            } else {
                const msg = (result.data && result.data.error) || "Something went wrong. Please try again.";
                showError(registerForm, msg);
            }
        });
    }

    // ---------- Logout ----------
    document.querySelectorAll("[data-logout]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
            const result = await postJSON("/api/auth/logout", {});
            const redirect = (result.data && result.data.data && result.data.data.redirect) || "/";
            window.location.href = redirect;
        });
    });
})();
