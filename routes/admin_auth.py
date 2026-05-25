from flask import Blueprint, request, jsonify, session

from extensions import mongo
from models import admin as admin_model


admin_auth_bp = Blueprint("admin_auth", __name__, url_prefix="/api/admin/auth")     # groups admin auth routes - completely separate from /api/auth used by regular users


def fn_ok_response(data=None, http_status=200):                                     # standard {success, data} shape used everywhere
    if data is None:
        data = {}
    return jsonify({"success": True, "data": data}), http_status


def fn_error_response(error_message, http_status=400):                              # standard {success: false, error: ...} shape
    return jsonify({"success": False, "error": error_message}), http_status


@admin_auth_bp.route("/login", methods=["POST"])
def fn_admin_login():
    request_data = request.get_json(silent=True)                                    # parse json body without crashing on bad input
    if request_data is None:
        request_data = {}

    email_address = request_data.get("email")
    if email_address is None:
        email_address = ""
    email_address = email_address.strip().lower()

    plain_text_password = request_data.get("password")
    if plain_text_password is None:
        plain_text_password = ""

    if not email_address or not plain_text_password:                                # generic message to avoid hinting which field is wrong
        return fn_error_response("Invalid email or password.", 400)

    found_admin = admin_model.fn_find_admin_by_email(mongo, email_address)          # looks ONLY in the admin collection - a regular user cannot log in here
    if not found_admin:
        return fn_error_response("Invalid email or password.", 400)

    stored_password_hash = found_admin.get("password_hash", "")
    if not admin_model.fn_verify_password(plain_text_password, stored_password_hash):
        return fn_error_response("Invalid email or password.", 400)

    session.clear()                                                                 # wipe any pre-existing user_id - we never want an admin and a user session overlapping
    session.permanent = True
    session["admin_id"] = str(found_admin["_id"])                                   # separate key from user_id, fn_admin_required checks for this exact key

    return fn_ok_response({"redirect": "/admin"})


@admin_auth_bp.route("/logout", methods=["POST"])
def fn_admin_logout():
    session.pop("admin_id", None)                                                   # pop, not clear, so any unrelated flash messages stay - but admin_id is the only key we set, so this is effectively a clear
    return fn_ok_response({"redirect": "/admin/login"})
