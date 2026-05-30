// browser sided auth logic for forms, saves time isntead of going to server each time
(function () {

    // literally makes js behave strictly. eg not allowing us to use undeclared variables.
    "use strict";

    // shows errors on forms when an error is meant to be shown. errors come from server sided auth.
    function fnShowFormError(formElement, errorMessage) {
        
        // this looks for the html element for data-from-error
        var formErrorElement = formElement.querySelector("[data-form-error]");
        
        // makes the code no nothing if nothing is found
        if (!formErrorElement) {
            return;
        }

        // shows the error
        formErrorElement.textContent = errorMessage;
        formErrorElement.classList.remove("hidden");
    }


    // removes the old errror - code logic is the same as above just hiding it
    function fnClearFormError(formElement) {
        var formErrorElement = formElement.querySelector("[data-form-error]");
        if (!formErrorElement) {
            return;
        }
        formErrorElement.textContent = "";
        formErrorElement.classList.add("hidden");
    }


    // shows a green success message on forms that have a [data-form-success] element (eg the reset password flow)
    function fnShowFormSuccess(formElement, successMessage) {
        var formSuccessElement = formElement.querySelector("[data-form-success]");
        if (!formSuccessElement) {
            return;
        }
        formSuccessElement.textContent = successMessage;
        formSuccessElement.classList.remove("hidden");
    }


    // just a helper function to post json data to the server. saves us writing this logic each time we want to post something
    async function fnPostJSON(requestUrl, requestBody) {
        var fetchResponse = await fetch(requestUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            credentials: "same-origin"
        });
        var responseData = {};
        try {
            responseData = await fetchResponse.json();
        } catch (parseError) {}
        return {
            ok: fetchResponse.ok,
            status: fetchResponse.status,
            data: responseData
        };
    }


    // calculates age from date of birth - server check this again, but this is a quick test to avoid sending the data in the first place
    function fnGetAgeFromDob(dateOfBirthString) {
        var userDateOfBirth = new Date(dateOfBirthString);

        // ensures date of birth is a real date
        if (isNaN(userDateOfBirth.getTime())) {
            return null;
        }

        // gets current date
        var currentDate = new Date();
        var userAge = currentDate.getFullYear() - userDateOfBirth.getFullYear();
        var monthDifference = currentDate.getMonth() - userDateOfBirth.getMonth();

        // has birthday not yet come this year? or is it same month but too early in days? - this will minus one from age
        if (monthDifference < 0) {
            userAge--;
        } else if (monthDifference === 0 && currentDate.getDate() < userDateOfBirth.getDate()) {
            userAge--;
        }
        return userAge;
    }

    // log in form to avoid full page reloads
    var loginFormElement = document.getElementById("login-form");
    
    // dont load this if there is no login form
    if (loginFormElement) {

        // runs when form is submitted
        loginFormElement.addEventListener("submit", async function (submitEvent) {

            // stops the browser doing a full page reload
            submitEvent.preventDefault();

            // clears any errors using function from way above                         
            fnClearFormError(loginFormElement);

            var emailInputValue = loginFormElement.email.value.trim();
            var passwordInputValue = loginFormElement.password.value;

            // simple client side check - server will check again anyway
            if (!emailInputValue || !passwordInputValue) {
                fnShowFormError(loginFormElement, "Please enter your email and password.");
                return;
            }

            // hidden field set by Jinja from ?next=... query param, see login.html
            var nextUrlField = loginFormElement.querySelector("[data-next-url]");
            var loginNextUrl = nextUrlField ? nextUrlField.value : "/dashboard";

            // only allow same-origin paths, server enforces this too but defence in depth
            if (!loginNextUrl || !loginNextUrl.startsWith("/")) {
                loginNextUrl = "/dashboard";
            }
            
            // sends email and password to server
            var loginResult = await fnPostJSON("/api/auth/login", { email: emailInputValue, password: passwordInputValue, next: loginNextUrl });
            
            // if login successful
            if (loginResult.data && loginResult.data.success) {
                var loginRedirectUrl = "/dashboard";

                // redirect to location from server or dashboard as backup
                if (loginResult.data.data && loginResult.data.data.redirect) {
                    loginRedirectUrl = loginResult.data.data.redirect;
                }
                window.location.href = loginRedirectUrl;
            } else {
                var loginErrorMessage = "Something went wrong. Please try again.";
                if (loginResult.data && loginResult.data.error) {
                    loginErrorMessage = loginResult.data.error;
                }
                fnShowFormError(loginFormElement, loginErrorMessage);
            }
        });
    }


    // register form to avoid full page reloads
    var registerFormElement = document.getElementById("register-form");             
    
    // only load if there is a form
    if (registerFormElement) {
        
        // wait until it is submitted
        registerFormElement.addEventListener("submit", async function (submitEvent) {
            submitEvent.preventDefault();                         

            // prevents full page reload                             
            fnClearFormError(registerFormElement);

            var passwordInputValue = registerFormElement.password.value;
            var confirmPasswordInputValue = registerFormElement.confirm_password.value;

            // client side check to see if passwords match
            if (passwordInputValue !== confirmPasswordInputValue) {
                fnShowFormError(registerFormElement, "Passwords do not match.");
                return;
            }

            // client sided age check 
            var userAge = fnGetAgeFromDob(registerFormElement.dob.value);

            if (userAge === null) {
                fnShowFormError(registerFormElement, "Please enter a valid date of birth.");
                return;
            }
            if (userAge < 18) {
                fnShowFormError(registerFormElement, "You must be 18 or over to register.");
                return;
            }

            // same trick as login, preserves ?next=... through registration
            var regNextUrlField = registerFormElement.querySelector("[data-next-url]");
            var regNextUrl = regNextUrlField ? regNextUrlField.value : "/dashboard";

            // only allow same-origin paths prevents open-redirect attacks
            if (!regNextUrl || !regNextUrl.startsWith("/")) {
                regNextUrl = "/dashboard";
            }

            // creates payload to send to server
            var registrationPayload = {
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

            // sends payload to server
            var registerResult = await fnPostJSON("/api/auth/register", registrationPayload);
            if (registerResult.data && registerResult.data.success) {
                var registerRedirectUrl = "/dashboard";

                // same as before - will go to server provided location or dashboard
                if (registerResult.data.data && registerResult.data.data.redirect) {
                    registerRedirectUrl = registerResult.data.data.redirect;
                }
                window.location.href = registerRedirectUrl;
            } else {
                var registerErrorMessage = "Something went wrong. Please try again.";
                if (registerResult.data && registerResult.data.error) {
                    registerErrorMessage = registerResult.data.error;
                }
                fnShowFormError(registerFormElement, registerErrorMessage);
            }
        });
    }

    // forgot password form - asks the server to email a reset link
    var forgotPasswordFormElement = document.getElementById("forgot-password-form");
    if (forgotPasswordFormElement) {
        forgotPasswordFormElement.addEventListener("submit", async function (submitEvent) {
            submitEvent.preventDefault();
            fnClearFormError(forgotPasswordFormElement);

            var forgotEmailValue = forgotPasswordFormElement.email.value.trim();
            if (!forgotEmailValue) {
                fnShowFormError(forgotPasswordFormElement, "Please enter your email address.");
                return;
            }

            var forgotResult = await fnPostJSON("/api/auth/forgot-password", { email: forgotEmailValue });

            // the server always returns success here so we never reveal whether the email is registered
            if (forgotResult.data && forgotResult.data.success) {
                var forgotMessage = "If that email is registered, a reset link has been sent.";
                if (forgotResult.data.data && forgotResult.data.data.message) {
                    forgotMessage = forgotResult.data.data.message;
                }
                fnShowFormSuccess(forgotPasswordFormElement, forgotMessage);
                forgotPasswordFormElement.querySelector("button[type=submit]").disabled = true;
            } else {
                var forgotErrorMessage = "Something went wrong. Please try again.";
                if (forgotResult.data && forgotResult.data.error) {
                    forgotErrorMessage = forgotResult.data.error;
                }
                fnShowFormError(forgotPasswordFormElement, forgotErrorMessage);
            }
        });
    }


    // reset password form - submits the emailed token plus the new password
    var resetPasswordFormElement = document.getElementById("reset-password-form");
    if (resetPasswordFormElement) {
        resetPasswordFormElement.addEventListener("submit", async function (submitEvent) {
            submitEvent.preventDefault();
            fnClearFormError(resetPasswordFormElement);

            var resetTokenValue = resetPasswordFormElement.token.value;
            var resetPasswordValue = resetPasswordFormElement.password.value;
            var resetConfirmValue = resetPasswordFormElement.confirm_password.value;

            // client side check - server validates the same rules again
            if (resetPasswordValue !== resetConfirmValue) {
                fnShowFormError(resetPasswordFormElement, "Passwords do not match.");
                return;
            }
            if (resetPasswordValue.length < 8) {
                fnShowFormError(resetPasswordFormElement, "Password must be at least 8 characters and contain a letter and a number.");
                return;
            }

            var resetResult = await fnPostJSON("/api/auth/reset-password", { token: resetTokenValue, password: resetPasswordValue });

            if (resetResult.data && resetResult.data.success) {
                fnShowFormSuccess(resetPasswordFormElement, "Password updated. Redirecting you to log in...");
                window.location.href = "/login";
            } else {
                var resetErrorMessage = "Something went wrong. Please try again.";
                if (resetResult.data && resetResult.data.error) {
                    resetErrorMessage = resetResult.data.error;
                }
                fnShowFormError(resetPasswordFormElement, resetErrorMessage);
            }
        });
    }


    // finds all logout buttons
    document.querySelectorAll("[data-logout]").forEach(function (logoutButtonElement) {
        
        // runs when clicked         
        logoutButtonElement.addEventListener("click", async function () {
            
            // sends logout request         
            var logoutResult = await fnPostJSON("/api/auth/logout", {});
            
            // redirect to server provided location or homepage
            var logoutRedirectUrl = "/";
            if (logoutResult.data && logoutResult.data.data && logoutResult.data.data.redirect) {
                logoutRedirectUrl = logoutResult.data.data.redirect;
            }
            window.location.href = logoutRedirectUrl;
        });
    });
})();