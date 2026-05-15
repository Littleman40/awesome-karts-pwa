// browser sided auth logic for forms.
(function () {
    "use strict";                                                                                           // literally makes js behave strictly. eg not allowing us to use undeclared variables.


    function fnShowFormError(formElement, errorMessage) {                                                   // shows errors on forms when an error is meant to be shown. errors come from server sided auth.
        var formErrorElement = formElement.querySelector("[data-form-error]");                              // this looks for the html element for data-from-error
        if (!formErrorElement) {                                                                            // makes the code no nothing if nothing is found
            return;
        }
        formErrorElement.textContent = errorMessage;                                                        // serves the message
        formErrorElement.classList.remove("hidden");                                                        // shows the message
    }

    function fnClearFormError(formElement) {                                                                // removes the old errror - code logic is the same as above just hiding it
        var formErrorElement = formElement.querySelector("[data-form-error]");
        if (!formErrorElement) {
            return;
        }
        formErrorElement.textContent = "";
        formErrorElement.classList.add("hidden");
    }


    async function fnPostJSON(requestUrl, requestBody) {                                                    // just a helper function to post json data to the server. saves us writing this logic each time we want to post something
        var fetchResponse = await fetch(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            credentials: "same-origin"
        });
        var responseData = {};
        try {
            responseData = await fetchResponse.json();
        } catch (parseError) {}                                                                             // safety fallback which prevents crashes if json is incorrect like servers being down etc
        return {
            ok: fetchResponse.ok,
            status: fetchResponse.status,
            data: responseData
        };
    }


    function fnGetAgeFromDob(dateOfBirthString) {                                                           // calculates age from date of birth - server check this again, but this is a quick test to avoid sending the data in the first place
        var userDateOfBirth = new Date(dateOfBirthString);
        if (isNaN(userDateOfBirth.getTime())) {                                                             // ensures date of birth is a real date
            return null;
        }
        var currentDate = new Date();                                                                       // gets current date
        var userAge = currentDate.getFullYear() - userDateOfBirth.getFullYear();
        var monthDifference = currentDate.getMonth() - userDateOfBirth.getMonth();
        if (monthDifference < 0) {                                                                          // has birthday not yet come this year? or is it same month but too early in days? - this will minus one from age
            userAge--;
        } else if (monthDifference === 0 && currentDate.getDate() < userDateOfBirth.getDate()) {
            userAge--;
        }
        return userAge;
    }


    var loginFormElement = document.getElementById("login-form");                                           // log in form to avoid full page reloads
    if (loginFormElement) {                                                                                 // dont load this if there is no login form
        loginFormElement.addEventListener("submit", async function (submitEvent) {                          // runs when form is submitted
            submitEvent.preventDefault();                                                                   // stops the browser doing a full page reload 
            fnClearFormError(loginFormElement);                                                             // clears any errors using function from way above

            var emailInputValue = loginFormElement.email.value.trim();
            var passwordInputValue = loginFormElement.password.value;

            if (!emailInputValue || !passwordInputValue) {                                                  // simple client side check - server will check again anyway
                fnShowFormError(loginFormElement, "Please enter your email and password.");
                return;                                                                                     // stops rest of function
            }

            var nextUrlField = loginFormElement.querySelector("[data-next-url]");                           // hidden field set by Jinja from ?next=... query param, see login.html
            var loginNextUrl = nextUrlField ? nextUrlField.value : "/dashboard";
            if (!loginNextUrl || !loginNextUrl.startsWith("/")) {                                           // only allow same-origin paths, server enforces this too but defence in depth
                loginNextUrl = "/dashboard";
            }

            var loginResult = await fnPostJSON("/api/auth/login", { email: emailInputValue, password: passwordInputValue, next: loginNextUrl });    // sends email and password to server
            if (loginResult.data && loginResult.data.success) {                                             // if login successful
                var loginRedirectUrl = "/dashboard";
                if (loginResult.data.data && loginResult.data.data.redirect) {                              // redirect to location from server or dashboard as backup
                    loginRedirectUrl = loginResult.data.data.redirect;
                }
                window.location.href = loginRedirectUrl;
            } else {
                var loginErrorMessage = "Something went wrong. Please try again.";                          // error if login failed
                if (loginResult.data && loginResult.data.error) {
                    loginErrorMessage = loginResult.data.error;
                }
                fnShowFormError(loginFormElement, loginErrorMessage);
            }
        });
    }


    var registerFormElement = document.getElementById("register-form");                                     // register form to avoid full page reloads
    if (registerFormElement) {                                                                              // only load if there is a form
        registerFormElement.addEventListener("submit", async function (submitEvent) {                       // wait until it is submitted
            submitEvent.preventDefault();                                                                   // prevents full page reload
            fnClearFormError(registerFormElement);

            var passwordInputValue = registerFormElement.password.value;
            var confirmPasswordInputValue = registerFormElement.confirm_password.value;

            if (passwordInputValue !== confirmPasswordInputValue) {                                         // client side check to see if passwords match
                fnShowFormError(registerFormElement, "Passwords do not match.");
                return;
            }

            var userAge = fnGetAgeFromDob(registerFormElement.dob.value);                                   // client sided age check 

            if (userAge === null) {
                fnShowFormError(registerFormElement, "Please enter a valid date of birth.");
                return;
            }
            if (userAge < 18) {
                fnShowFormError(registerFormElement, "You must be 18 or over to register.");
                return;
            }

            var regNextUrlField = registerFormElement.querySelector("[data-next-url]");                      // same trick as login, preserves ?next=... through registration
            var regNextUrl = regNextUrlField ? regNextUrlField.value : "/dashboard";
            if (!regNextUrl || !regNextUrl.startsWith("/")) {                                                // only allow same-origin paths prevents open-redirect attacks
                regNextUrl = "/dashboard";
            }

            var registrationPayload = {                                                                     // creates payload to send to server
                first_name: registerFormElement.first_name.value.trim(),
                last_name: registerFormElement.last_name.value.trim(),
                gender: registerFormElement.gender.value,
                dob: registerFormElement.dob.value,
                address: registerFormElement.address.value.trim(),
                phone: registerFormElement.phone.value.trim(),
                email: registerFormElement.email.value.trim(),
                password: passwordInputValue,
                next: regNextUrl
            };

            var registerResult = await fnPostJSON("/api/auth/register", registrationPayload);               // sends payload to server
            if (registerResult.data && registerResult.data.success) {
                var registerRedirectUrl = "/dashboard";
                if (registerResult.data.data && registerResult.data.data.redirect) {                        // same as before - will go to server provided location or dashboard
                    registerRedirectUrl = registerResult.data.data.redirect;
                }
                window.location.href = registerRedirectUrl;
            } else {
                var registerErrorMessage = "Something went wrong. Please try again.";                       // error handling
                if (registerResult.data && registerResult.data.error) {
                    registerErrorMessage = registerResult.data.error;
                }
                fnShowFormError(registerFormElement, registerErrorMessage);
            }
        });
    }


    document.querySelectorAll("[data-logout]").forEach(function (logoutButtonElement) {                 // finds all logout buttons
        logoutButtonElement.addEventListener("click", async function () {                               // runs when clicked
            var logoutResult = await fnPostJSON("/api/auth/logout", {});                                // sends logout request
            var logoutRedirectUrl = "/";                                                                // redirect to server provided location or homepage
            if (logoutResult.data && logoutResult.data.data && logoutResult.data.data.redirect) {
                logoutRedirectUrl = logoutResult.data.data.redirect;
            }
            window.location.href = logoutRedirectUrl;
        });
    });
})();
