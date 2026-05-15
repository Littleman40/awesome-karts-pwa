from datetime import datetime, date as date_type
from flask import Blueprint, request, jsonify, session

from extensions import mongo                                                    # the shared mongo client created in extensions.py
from models import booking as booking_model                                     # imported as 'booking_model' for clarity (so we can write booking_model.fn_create_booking)
from utils.auth_decorators import fn_login_required                             # decorator that returns 401 if no session - same one used by auth/dashboard


bookings_bp = Blueprint("bookings", __name__, url_prefix="/api/bookings")       # groups all booking routes under /api/bookings - registered in app.py


def fn_ok_response(data=None, http_status=200):                                 # success response - matches the {success, data} format used by every other route
    if data is None:
        data = {}
    return jsonify({"success": True, "data": data}), http_status


def fn_error_response(error_message, http_status=400):                          # error response - matches the {success: false, error: ...} format used everywhere
    return jsonify({"success": False, "error": error_message}), http_status


@bookings_bp.route("/slots", methods=["GET"])                                   # returns the list of hourly time slots for a given date, each with a busy-meter status (low/medium/high/booked_out/blocked)
def fn_get_slots():
    date_string = request.args.get("date", "")
    total_drivers_string = request.args.get("total_drivers", "1")               # group size matters because a slot might fit 30 people but not 40

    try:
        booking_date = datetime.strptime(date_string, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return fn_error_response("Invalid date format. Use YYYY-MM-DD.")

    if booking_date < date_type.today():                                        # cant book in the past, front-end also disables this but always validate server-side
        return fn_error_response("Cannot book in the past.")

    try:
        total_drivers = int(total_drivers_string)
    except (ValueError, TypeError):
        total_drivers = 1                                                       # default to 1 if the parameter was malformed and still gives them sensible results
    if total_drivers < 1:
        total_drivers = 1

    result = booking_model.fn_get_slots_for_date(mongo, booking_date, total_drivers)
    return fn_ok_response(result)                                               # result is either {blocked: true, reason} or {blocked: false, slots: [...]}


@bookings_bp.route("/create", methods=["POST"])
@fn_login_required                                                              # must be logged in
def fn_create_booking():                                                        # creates a booking + atomically reserves capacity in the slot
    user_id = session["user_id"]                                                # set by /api/auth/login - fn_login_required already guaranteed it exists
    request_data = request.get_json(silent=True)
    if request_data is None:                                                    # body wasnt json or was empty - fall back to empty dict so .get() doesn't crash
        request_data = {}

    date_string = request_data.get("date", "")
    time_slot_raw = request_data.get("time_slot")
    adult_count_raw = request_data.get("adult_count", 0)
    junior_count_raw = request_data.get("junior_count", 0)
    package_id = request_data.get("package_id", "")
    extra_rides_raw = request_data.get("extra_rides", 0)

    try:                                                                        # date validation
        booking_date = datetime.strptime(date_string, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return fn_error_response("Invalid date.")

    if booking_date < date_type.today():                                        # never trust the front end — re-check past-date here
        return fn_error_response("Cannot book in the past.")

    if time_slot_raw is None:
        return fn_error_response("Please select a time slot.")

    try:                                                                        # ensure correct date types
        time_slot = int(time_slot_raw)
        adult_count = int(adult_count_raw)
        junior_count = int(junior_count_raw)
        extra_rides = int(extra_rides_raw)
    except (ValueError, TypeError):
        return fn_error_response("Invalid booking data.")

    if adult_count < 0 or junior_count < 0:                                     # negative numbers are nonsensical and protects against tampering
        return fn_error_response("Driver counts cannot be negative.")

    if adult_count + junior_count < 1:                                          # cant book with zero drivers
        return fn_error_response("At least 1 driver is required.")

    valid_packages = {"1_ride", "2_rides", "3_rides", "4_plus"}                 # anything outside this is rejected
    if package_id not in valid_packages:
        return fn_error_response("Please select a valid package.")

    if package_id == "4_plus" and extra_rides < 1:                              # custom package needs at least 1 extra ride to make sense
        return fn_error_response("Please specify at least 1 extra ride for the custom package.")

    booking_data = {
        "date": booking_date,
        "time_slot": time_slot,
        "adult_count": adult_count,
        "junior_count": junior_count,
        "package_id": package_id,
        "extra_rides": extra_rides,
    }

    booking_id, share_token, error = booking_model.fn_create_booking(mongo, user_id, booking_data)
    if error is not None:                                                       # if model says no it could be slot full, blocked day, etc
        return fn_error_response(error)

    return fn_ok_response({
        "booking_id": booking_id,
        "share_token": share_token,
        "share_url": f"/bookings/share/{share_token}",                          # convenience so front end doesnt have to build the url itself
    }, 201)                                                                     # created return status code


@bookings_bp.route("/share/<share_token>/add", methods=["POST"])                # adds the currently-logged-in user to the booking's linked_user_ids array
@fn_login_required
def fn_add_booking_to_account(share_token):
    user_id = session["user_id"]
    booking = booking_model.fn_find_booking_by_share_token(mongo, share_token)
    if booking is None:
        return fn_error_response("Booking not found.", 404)
    booking_model.fn_add_linked_user(mongo, share_token, user_id)
    return fn_ok_response({"message": "Booking added to your account."})
