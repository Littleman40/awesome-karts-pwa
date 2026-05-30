# user account routes
from datetime import datetime
from flask import Blueprint, request, jsonify, session
from bson import ObjectId

from extensions import mongo
from models import booking as booking_model
from models import minor as minor_model
from models.user import fn_find_user_by_id, fn_delete_user_account
from services import email_service
from utils.auth_decorators import fn_login_required


# everything here is under /api/users registered in app.py
users_bp = Blueprint("users", __name__, url_prefix="/api/users")


# standard success response same shape as every other route
def fn_ok_response(data=None, http_status=200):
    if data is None:
        data = {}
    return jsonify({"success": True, "data": data}), http_status


# standard error response
def fn_error_response(error_message, http_status=400):
    return jsonify({"success": False, "error": error_message}), http_status


# returns the current user's bookings (creator OR linked-via-share), split into upcoming vs past/cancelled
@users_bp.route("/me/bookings", methods=["GET"])
@fn_login_required
def fn_get_my_bookings():
    user_id = session["user_id"]
    all_bookings = booking_model.fn_get_user_bookings(mongo, user_id)
    upcoming_bookings = []
    past_bookings = []
    for booking_doc in all_bookings:

        # convert each mongo doc to json-friendly dict (also adds is_creator / is_past flags)
        formatted_booking = booking_model.fn_format_booking_for_api(booking_doc, user_id)   
        is_inactive = formatted_booking["payment_status"] in ("cancelled", "refunded")

        # cancelled/refunded (any date) and finished bookings belong in the past section
        if is_inactive or formatted_booking["is_past"]:
            past_bookings.append(formatted_booking)
        else:
            upcoming_bookings.append(formatted_booking)

    # all_bookings is sorted soonest-first; show the past list most-recent-first instead
    past_bookings.reverse()
    return fn_ok_response({"upcoming": upcoming_bookings, "past": past_bookings})


# full detail for one booking, used by the dashboard's click-to-expand detail modal
@users_bp.route("/me/bookings/<booking_id_string>", methods=["GET"])
@fn_login_required
def fn_get_my_booking_detail(booking_id_string):
    user_id = session["user_id"]
    booking_doc = booking_model.fn_find_booking_by_id(mongo, booking_id_string)
    if booking_doc is None:
        return fn_error_response("Booking not found.", 404)

    try:
        user_object_id = ObjectId(user_id)
    except Exception:
        return fn_error_response("Booking not found.", 404)
    
    # only people on the booking can view its detail
    if user_object_id not in booking_doc.get("linked_user_ids", []):
        return fn_error_response("Booking not found.", 404)

    formatted = booking_model.fn_format_booking_for_api(booking_doc, user_id)

    creator_id = booking_doc.get("creator_user_id")

    # everyone this booking shows up for
    attendees = []
    for linked_id in booking_doc.get("linked_user_ids", []):
        attendee_doc = mongo.db.users.find_one({"_id": linked_id}, {"first_name": 1, "last_name": 1})
        if attendee_doc is not None:
            attendees.append({
                "name": (attendee_doc.get("first_name", "") + " " + attendee_doc.get("last_name", "")).strip(),
                "is_you": linked_id == user_object_id,
                "is_creator": linked_id == creator_id,
            })
    formatted["attendees"] = attendees

    paid_at = booking_doc.get("paid_at")
    formatted["paid_at"] = paid_at.isoformat() if paid_at else None
    return fn_ok_response(formatted)


# returns the current user's registered minors for the dashboard's "My Minors" section
@users_bp.route("/me/minors", methods=["GET"])
@fn_login_required
def fn_get_my_minors():
    user_id = session["user_id"]
    minors = minor_model.fn_get_user_minors(mongo, user_id)

    # the formatter also computes age from dob, saving the front end from doing date math
    formatted = [minor_model.fn_format_minor_for_api(m) for m in minors]
    return fn_ok_response(formatted)


# registers a new minor under the current user
@users_bp.route("/me/minors", methods=["POST"])
@fn_login_required
def fn_add_my_minor():
    user_id = session["user_id"]
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}
    
    # this model does all the validation
    minor_id, error = minor_model.fn_add_minor(mongo, user_id, request_data)
    if error is not None:
        return fn_error_response(error)
    return fn_ok_response({"id": minor_id}, 201)


# removes one of the current user's registered minors
@users_bp.route("/me/minors/<minor_id_string>", methods=["DELETE"])
@fn_login_required
def fn_remove_my_minor(minor_id_string):
    user_id = session["user_id"]
    removed = minor_model.fn_remove_minor(mongo, user_id, minor_id_string)
    if not removed:
        return fn_error_response("Minor not found.", 404)
    return fn_ok_response()


# returns the current user's waiver status abd all their minors waiver statuses for the dashboard's Waivers section    
@users_bp.route("/me/waiver-status", methods=["GET"])
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


# marks the current user's own waiver as signed
@users_bp.route("/me/waiver/sign", methods=["POST"])
@fn_login_required
def fn_sign_my_waiver():
    user_id = session["user_id"]
    mongo.db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"waiver_accepted": True, "waiver_accepted_at": datetime.utcnow()}},
    )
    return fn_ok_response()


# parent/guardian signs a waiver on behalf of a minor
@users_bp.route("/me/minors/<minor_id_string>/waiver/sign", methods=["POST"])           
@fn_login_required
def fn_sign_minor_waiver_route(minor_id_string):
    user_id = session["user_id"]
    signed = minor_model.fn_sign_minor_waiver(mongo, user_id, minor_id_string)
    if not signed:
        return fn_error_response("Minor not found.", 404)
    return fn_ok_response()


# permanent account deletion - cancels bookings, removes minors and waivers, drops user doc
@users_bp.route("/me", methods=["DELETE"])
@fn_login_required
def fn_delete_my_account():
    user_id = session["user_id"]

    # capture the email + name BEFORE deletion, since the user doc is about to be removed
    user_to_delete = fn_find_user_by_id(mongo, user_id)
    deletion_email = user_to_delete.get("email") if user_to_delete is not None else None
    deletion_first_name = user_to_delete.get("first_name") if user_to_delete is not None else None

    deleted = fn_delete_user_account(mongo, user_id)
    if not deleted:
        return fn_error_response("Account could not be deleted.", 400)

    # confirm the deletion by email - fire-and-forget so a send failure never blocks the deletion
    if deletion_email:
        try:
            email_service.fn_send_account_deleted(deletion_email, deletion_first_name)
        except Exception as deletion_email_error:
            from flask import current_app
            current_app.logger.warning(f"Account deletion email failed for {deletion_email}: {deletion_email_error}")

    # log them out so the next page load doesn't try to load a deleted user
    session.clear()
    return fn_ok_response({"redirect": "/"})
