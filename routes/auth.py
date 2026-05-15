from flask import Blueprint, request, jsonify, session
from pymongo.errors import DuplicateKeyError

from extensions import mongo                                # imports from other files in project
from models import user as user_model                       # imports from other files in project
from utils.validators import fn_validate_registration       # imports from other files in project


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")                               # makes code cleaner by grouping auth together


def fn_ok_response(response_payload=None, http_status=200):                                 # success response
    if response_payload is None:
        response_payload = {}
    return jsonify({"success": True, "data": response_payload}), http_status


def fn_error_response(error_message, http_status=400):                                      # error response
    return jsonify({"success": False, "error": error_message}), http_status


@auth_bp.route("/register", methods=["POST"])
def fn_register():
    request_data = request.get_json(silent=True)                                            # reads json body and returns none to avoid crashes if malformed
    if request_data is None:
        request_data = {}

    result = fn_validate_registration(request_data)                                         # server sided validation - validation returns 2 values cleaned data and error message
    cleaned_user_data = result[0]
    validation_error = result[1]
    
    if validation_error:
        return fn_error_response(validation_error, 400)                                     # returns error is error exists

    if user_model.fn_check_email_exists(mongo, cleaned_user_data["email"]):                 # duplicate email check
        return fn_error_response("An account with this email already exists.", 400)

    try:
        new_user_id = user_model.fn_create_user(mongo, cleaned_user_data)                   # create the user
    except DuplicateKeyError:
        return fn_error_response("An account with this email already exists.", 400)         # more error handling just in case

    session.permanent = True                                                                # log in the user so they dont need to log in after registering
    session["user_id"] = new_user_id

    next_url = request_data.get("next", "/dashboard")                                       # client may send a `next` URL (eg "/bookings") so we redirect there after login
    if not isinstance(next_url, str) or not next_url.startswith("/"):                       # only allow same-origin paths, prevents open-redirect attacks like next=https://evil.example
        next_url = "/dashboard"

    return fn_ok_response({"redirect": next_url}, 201)                                      # return successful response and redirect to dashboard (or next)


@auth_bp.route("/login", methods=["POST"])
def fn_login():
    request_data = request.get_json(silent=True)                                            # reads json body and returns none to avoid crashes if malformed
    if request_data is None:
        request_data = {}

    email_address = request_data.get("email")
    if email_address is None:
        email_address = ""                                                                  # set null to nothing to avoid crashes
    email_address = email_address.strip().lower()

    plain_text_password = request_data.get("password")
    if plain_text_password is None:                                                         # set null to nothing to avoid crashes
        plain_text_password = ""

    if not email_address or not plain_text_password:
        return fn_error_response("Invalid email or password.", 400)                         # generic message to avoid giving hints about which field is wrong - done for everything below too

    found_user = user_model.fn_find_user_by_email(mongo, email_address)
    if not found_user:                                                                      # checks if user exists
        return fn_error_response("Invalid email or password.", 400) 

    stored_password_hash = found_user.get("password_hash")                                  # checks password hash
    if stored_password_hash is None:
        stored_password_hash = ""

    if not user_model.fn_verify_password(plain_text_password, stored_password_hash):
        return fn_error_response("Invalid email or password.", 400)

    session.permanent = True                                                                # log in with session cookie
    session["user_id"] = str(found_user["_id"])

    next_url = request_data.get("next", "/dashboard")                                       # client may send a `next` URL (eg "/bookings") so we redirect there after login
    if not isinstance(next_url, str) or not next_url.startswith("/"):                       # only allow same-origin paths, prevents open-redirect attacks like next=https://evil.example
        next_url = "/dashboard"

    return fn_ok_response({"redirect": next_url})                                           # success and redirect to dashboard (or next)



@auth_bp.route("/logout", methods=["POST"])
def fn_logout():
    session.clear()                                                                         # clears session cookie to log out user
    return fn_ok_response({"redirect": "/"})
