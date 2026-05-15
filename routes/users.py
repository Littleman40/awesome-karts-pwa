from datetime import datetime
from flask import Blueprint, request, jsonify, session
from bson import ObjectId

from extensions import mongo                                                    # shared mongo client (see extensions.py)
from models import booking as booking_model                                     # used for fetching this user's bookings
from models import minor as minor_model                                         # used for the "my minors" endpoints
from models.user import fn_find_user_by_id                                      # used by the waiver-status endpoint to read the user doc
from utils.auth_decorators import fn_login_required                             # all endpoints in this file are user-specific so they all require login


users_bp = Blueprint("users", __name__, url_prefix="/api/users")                # everything here is under /api/users registered in app.py


def fn_ok_response(data=None, http_status=200):                                 # standard success response same shape as every other route
    if data is None:
        data = {}
    return jsonify({"success": True, "data": data}), http_status


def fn_error_response(error_message, http_status=400):                          # standard error response
    return jsonify({"success": False, "error": error_message}), http_status


@users_bp.route("/me/bookings", methods=["GET"])                                    # returns the current user's upcoming bookings (creator OR linked-via-share)
@fn_login_required
def fn_get_my_bookings():
    user_id = session["user_id"]
    bookings = booking_model.fn_get_user_upcoming_bookings(mongo, user_id)
    formatted = [booking_model.fn_format_booking_for_api(b, user_id) for b in bookings]   # convert each mongo doc to json-friendly dict (also adds is_creator flag)
    return fn_ok_response(formatted)


@users_bp.route("/me/minors", methods=["GET"])                                           # returns the current user's registered minors for the dashboard's "My Minors" section
@fn_login_required
def fn_get_my_minors():
    user_id = session["user_id"]
    minors = minor_model.fn_get_user_minors(mongo, user_id)
    formatted = [minor_model.fn_format_minor_for_api(m) for m in minors]                # the formatter also computes age from dob, saving the front end from doing date math
    return fn_ok_response(formatted)


@users_bp.route("/me/minors", methods=["POST"])                                         # registers a new minor under the current user
@fn_login_required
def fn_add_my_minor():
    user_id = session["user_id"]
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}
    minor_id, error = minor_model.fn_add_minor(mongo, user_id, request_data)            # model does all the validation (age 8-17, gender whitelist, etc)
    if error is not None:
        return fn_error_response(error)
    return fn_ok_response({"id": minor_id}, 201)


@users_bp.route("/me/minors/<minor_id_string>", methods=["DELETE"])                     # removes one of the current user's registered minors
@fn_login_required
def fn_remove_my_minor(minor_id_string):
    user_id = session["user_id"]
    removed = minor_model.fn_remove_minor(mongo, user_id, minor_id_string)
    if not removed:
        return fn_error_response("Minor not found.", 404)
    return fn_ok_response()


@users_bp.route("/me/waiver-status", methods=["GET"])                                   # returns the current user's waiver status abd all their minors' waiver statuses for the dashboard's "Waivers" section    
@fn_login_required
def fn_get_waiver_status():
    user_id = session["user_id"]
    user = fn_find_user_by_id(mongo, user_id)
    if user is None:
        return fn_error_response("User not found.", 404)
    waiver_at = user.get("waiver_accepted_at")
    user_status = {
        "waiver_accepted": user.get("waiver_accepted", False),
        "waiver_accepted_at": waiver_at.isoformat() if waiver_at else None,
    }
    minors = minor_model.fn_get_user_minors(mongo, user_id)
    minor_statuses = []
    for m in minors:
        m_waiver_at = m.get("waiver_accepted_at")
        minor_statuses.append({
            "id": str(m["_id"]),
            "name": (m.get("first_name", "") + " " + m.get("last_name", "")).strip(),
            "waiver_accepted": m.get("waiver_accepted", False),
            "waiver_accepted_at": m_waiver_at.isoformat() if m_waiver_at else None,
        })
    return fn_ok_response({"user": user_status, "minors": minor_statuses})


@users_bp.route("/me/waiver/sign", methods=["POST"])                                    # marks the current user's own waiver as signed
@fn_login_required
def fn_sign_my_waiver():
    user_id = session["user_id"]
    mongo.db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"waiver_accepted": True, "waiver_accepted_at": datetime.utcnow()}},
    )
    return fn_ok_response()


@users_bp.route("/me/minors/<minor_id_string>/waiver/sign", methods=["POST"])           # parent/guardian signs a waiver on behalf of a minor
@fn_login_required
def fn_sign_minor_waiver_route(minor_id_string):
    user_id = session["user_id"]
    signed = minor_model.fn_sign_minor_waiver(mongo, user_id, minor_id_string)
    if not signed:
        return fn_error_response("Minor not found.", 404)
    return fn_ok_response()
