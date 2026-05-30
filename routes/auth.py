# user authentication routes used for registering and log in
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, session
from pymongo.errors import DuplicateKeyError

from extensions import mongo
from models import user as user_model
from utils.validators import fn_validate_registration, fn_is_valid_password
from services import email_service


# makes code cleaner by grouping auth together
auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")                               

# success response
def fn_ok_response(response_payload=None, http_status=200):
    if response_payload is None:
        response_payload = {}
    return jsonify({"success": True, "data": response_payload}), http_status

# error response
def fn_error_response(error_message, http_status=400):
    return jsonify({"success": False, "error": error_message}), http_status


@auth_bp.route("/register", methods=["POST"])
def fn_register():

    # reads json body and returns none to avoid crashes if malformed
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}

    # server sided validation - validation returns 2 values cleaned data and error message
    result = fn_validate_registration(request_data)
    cleaned_user_data = result[0]
    validation_error = result[1]
    
    # returns error is error exists
    if validation_error:
        return fn_error_response(validation_error, 400)

    # duplicate email check
    if user_model.fn_check_email_exists(mongo, cleaned_user_data["email"]):
        return fn_error_response("An account with this email already exists.", 400)

    # create the user
    try:
        new_user_id = user_model.fn_create_user(mongo, cleaned_user_data)
    except DuplicateKeyError:
        return fn_error_response("An account with this email already exists.", 400)

    # log in the user so they dont need to log in after registering
    session.permanent = True
    session["user_id"] = new_user_id

    # fire-and-forget welcome email - a send failure must never block registration
    try:
        new_user_doc = user_model.fn_find_user_by_id(mongo, new_user_id)
        if new_user_doc is not None:
            email_service.fn_send_welcome(new_user_doc)
    except Exception as welcome_email_error:
        from flask import current_app
        current_app.logger.warning(f"Welcome email failed for {cleaned_user_data['email']}: {welcome_email_error}")

    # client may send a next URL (eg "/bookings") so we redirect there after login
    next_url = request_data.get("next", "/dashboard")

    # only allow same-origin paths, prevents open-redirect attacks like next=https://evil.example                               
    if not isinstance(next_url, str) or not next_url.startswith("/"):
        next_url = "/dashboard"

    return fn_ok_response({"redirect": next_url}, 201)


@auth_bp.route("/login", methods=["POST"])
def fn_login():
    # reads json body and returns none to avoid crashes if malformed
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}

    email_address = request_data.get("email")
    if email_address is None:
        email_address = ""
    email_address = email_address.strip().lower()

    plain_text_password = request_data.get("password")
    if plain_text_password is None:
        plain_text_password = ""

    # generic message to avoid giving hints about which field is wrong - done for everything below too
    if not email_address or not plain_text_password:
        return fn_error_response("Invalid email or password.", 400)                         

    # checks if user exists
    found_user = user_model.fn_find_user_by_email(mongo, email_address)
    if not found_user:
        return fn_error_response("Invalid email or password.", 400)

    # checks password hash
    stored_password_hash = found_user.get("password_hash")
    if stored_password_hash is None:
        stored_password_hash = ""

    if not user_model.fn_verify_password(plain_text_password, stored_password_hash):
        return fn_error_response("Invalid email or password.", 400)

    # log in with session cookie
    session.permanent = True
    session["user_id"] = str(found_user["_id"])

    # client may send a next URL (eg "/bookings") so we redirect there after login
    next_url = request_data.get("next", "/dashboard")

    # only allow same-origin paths, prevents open-redirect attacks like next=https://evil.example
    if not isinstance(next_url, str) or not next_url.startswith("/"):
        next_url = "/dashboard"

    return fn_ok_response({"redirect": next_url})



@auth_bp.route("/logout", methods=["POST"])
def fn_logout():

    # clears session cookie to log out user
    session.clear()

    return fn_ok_response({"redirect": "/"})


# step 1 of the reset flow - user submits their email and we send a single-use reset link
@auth_bp.route("/forgot-password", methods=["POST"])
def fn_forgot_password():
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}

    email_address = request_data.get("email")
    if email_address is None:
        email_address = ""
    email_address = email_address.strip().lower()

    if not email_address:
        return fn_error_response("Please enter your email address.")

    found_user = user_model.fn_find_user_by_email(mongo, email_address)

    # only do work if the account actually exists - but the response below is identical either way
    if found_user is not None:

        # invalidate any previous unused tokens so only the newest link works
        mongo.db.password_reset_tokens.delete_many({"user_id": found_user["_id"], "used": False})

        # unguessable url-safe token, stored with a 1-hour expiry
        reset_token = secrets.token_urlsafe(32)
        mongo.db.password_reset_tokens.insert_one({
            "user_id": found_user["_id"],
            "token": reset_token,
            "expires_at": datetime.utcnow() + timedelta(hours=1),
            "used": False,
        })

        # fire-and-forget - a send failure must not reveal that the address exists
        try:
            email_service.fn_send_password_reset(found_user, reset_token)
        except Exception as reset_email_error:
            from flask import current_app
            current_app.logger.warning(f"Password reset email failed for {email_address}: {reset_email_error}")

    # always return success so we never leak whether an email is registered
    return fn_ok_response({"message": "If that email is registered, a reset link has been sent."})


# step 2 of the reset flow - user submits the token plus a new password
@auth_bp.route("/reset-password", methods=["POST"])
def fn_reset_password():
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}

    reset_token = request_data.get("token")
    if reset_token is None:
        reset_token = ""
    reset_token = reset_token.strip()

    new_password = request_data.get("password")
    if new_password is None:
        new_password = ""

    if not reset_token or not new_password:
        return fn_error_response("Token and new password are required.")

    # token must exist, be unused, and not yet expired
    token_doc = mongo.db.password_reset_tokens.find_one({
        "token": reset_token,
        "used": False,
        "expires_at": {"$gt": datetime.utcnow()},
    })
    if token_doc is None:
        return fn_error_response("This reset link is invalid or has expired. Please request a new one.", 400)

    # same password rules as registration
    if not fn_is_valid_password(new_password):
        return fn_error_response("Password must be at least 8 characters and contain a letter and a number.")

    new_password_hash = user_model.fn_hash_password(new_password)
    mongo.db.users.update_one(
        {"_id": token_doc["user_id"]},
        {"$set": {"password_hash": new_password_hash}},
    )

    # mark the token used so the link can't be replayed
    mongo.db.password_reset_tokens.update_one(
        {"_id": token_doc["_id"]},
        {"$set": {"used": True}},
    )

    # security confirmation email - fire-and-forget
    reset_user_doc = user_model.fn_find_user_by_id(mongo, str(token_doc["user_id"]))
    if reset_user_doc is not None:
        try:
            email_service.fn_send_password_changed(reset_user_doc)
        except Exception as changed_email_error:
            from flask import current_app
            current_app.logger.warning(f"Password-changed email failed for user {token_doc['user_id']}: {changed_email_error}")

    return fn_ok_response({"message": "Password updated successfully."})
