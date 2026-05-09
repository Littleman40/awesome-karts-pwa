// browser sided auth logic for forms.
(function () {
    "use strict";                                                           // literally makes js behave strictly. eg not allowing us to use undeclared variables.


    function showError(form, message) {                                     // shows errors on forms when an error is meant to be shown. errors come from server sided auth.
        const errorElement = form.querySelector("[data-form-error]");       // this looks for the html element for data-from-error
        if (!errorElement) return;                                          // makes the code no nothing if nothing is found
        errorElement.textContent = message;                                 // serves the message
        errorElement.classList.remove("hidden");                            // shows the message
    }

    function clearError(form) {                                             // removes the old errror - code logic is the same as above just hiding it
        
        const errorElement = form.querySelector("[data-form-error]");
        if (!errorElement) return;
        errorElement.textContent = "";
        errorElement.classList.add("hidden");
    }


    async function postJSON(url, body) {                                    // just a helper function to post json data to the server. saves us writing this logic each time we want to post something
        const res = await fetch(url, {                                      
            method: "POST",
            headers: { "Content-Type": "application/json" },                
            body: JSON.stringify(body),                                     
            credentials: "same-origin"                                      
        });
        let data = {};                                                      
        try { 
            data = await res.json(); 
        } catch (_) {}                                                      // safety fallback which prevents crashes if json is incorrect like servers being down etc
        return { 
            ok: res.ok, 
            status: res.status, 
            data: data 
        }; 
    }


    function ageFromDob(dobStr) {                                           // calculates age from date of birth - server check this again, but this is a quick test to avoid sending the data in the first place
        const userDateOfBirth = new Date(dobStr);
        if (isNaN(userDateOfBirth.getTime())) {                             // ensures date of birth is a real date
            return null;
        }
        const currentdate = new Date();                                     // gets current date
        let userAge = currentdate.getFullYear() - userDateOfBirth.getFullYear();
        const monthDifference = currentdate.getMonth() - userDateOfBirth.getMonth();
        if (
            monthDifference < 0 ||                                          // has birthday not yet come this year? or is it same month but too early in days? - this will minus one from age
            (
                monthDifference === 0 &&
                currentDate.getDate() < userDateOfBirth.getDate()
            )
        ) {
            userAge--;
        }
        return userAge;
    }


    const loginForm = document.getElementById("login-form");                // log in form to avoid full page reloads
    if (loginForm) {                                                        // dont load this if there is no login form
        loginForm.addEventListener("submit", async function (e) {           // runs when form is submitted
            e.preventDefault();                                             // stops the browser doing a full page reload 
            clearError(loginForm);                                          // clears any errors using function from way above

            const email = loginForm.email.value.trim();
            const password = loginForm.password.value;

            if (!email || !password) {                                          // simple client side check - server will check again anyway
                showError(loginForm, "Please enter your email and password.");
                return;                                                         // stops rest of function
            }

            const result = await postJSON("/api/auth/login", { email, password });  // sends email and password to server and waits for response
            if (result.data && result.data.success) {                               // if login successful
                window.location.href = result.data.data.redirect || "/dashboard";   // redirect to location from server or dashboard as backup
            } else {
                const msg = (result.data && result.data.error) || "Something went wrong. Please try again."; // error if login failed
                showError(loginForm, msg);
            }
        });
    }


    const registerForm = document.getElementById("register-form");          // register form to avoid full page reloads
    if (registerForm) {                                                     // only load if there is a form
        registerForm.addEventListener("submit", async function (e) {        // wait until it is submitted
            e.preventDefault();                                             // prevents full page reload
            clearError(registerForm);

            const f = registerForm;
            const password = f.password.value;
            const confirmedpassword = f.confirm_password.value;

            
            if (password !== confirmedpassword) {                           // client side check to see if passwords match
                showError(registerForm, "Passwords do not match.");
                return;
            }

            const age = ageFromDob(f.dob.value);                            // client sided age check 

            if (age === null) {
                showError(registerForm, "Please enter a valid date of birth.");
                return;
            }
            if (age < 18) {
                showError(registerForm, "You must be 18 or over to register.");
                return;
            }

            const payload = {                                               // creates payload to send to server
                first_name: f.first_name.value.trim(),
                last_name: f.last_name.value.trim(),
                gender: f.gender.value,
                dob: f.dob.value,
                address: f.address.value.trim(),
                phone: f.phone.value.trim(),
                email: f.email.value.trim(),
                password: password
            };

            const result = await postJSON("/api/auth/register", payload);                                       // sends payload to server
            if (result.data && result.data.success) {
                window.location.href = result.data.data.redirect || "/dashboard";                               // same as before - will go to server provided location or dashboard
            } else {
                const msg = (result.data && result.data.error) || "Something went wrong. Please try again.";    // error handling
                showError(registerForm, msg);
            }
        });
    }



    document.querySelectorAll("[data-logout]").forEach(function (btn) {                             // finds all logout buttons
        btn.addEventListener("click", async function () {                                           // runs when clicked
            const result = await postJSON("/api/auth/logout", {});                                  // sends logout request
            const redirect = (result.data && result.data.data && result.data.data.redirect) || "/"; // redirect to server provided location or homepage
            window.location.href = redirect;
        });
    });
})();
