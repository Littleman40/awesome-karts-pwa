# routes for our booking page
from datetime import datetime, date as date_type
from flask import Blueprint, request, jsonify, session, current_app
from bson import ObjectId

from extensions import mongo
from models import booking as booking_model
from models.booking import PACKAGE_LABELS, fn_calculate_total, fn_format_hour_label
from services import stripe_service
from utils.auth_decorators import fn_login_required


# groups all booking routes under /api/bookings - registered in app.py
bookings_bp = Blueprint("bookings", __name__, url_prefix="/api/bookings")

# success response - matches the {success, data} format used by every other route
def fn_ok_response(data=None, http_status=200):
    if data is None:
        data = {}
    return jsonify({"success": True, "data": data}), http_status


# error response - matches the {success: false, error: ...} format used everywhere
def fn_error_response(error_message, http_status=400):                          
    return jsonify({"success": False, "error": error_message}), http_status


# returns the list of hourly time slots for a given date, each with a busy-meter status (low/medium/high/booked_out/blocked)
@bookings_bp.route("/slots", methods=["GET"])                                   
def fn_get_slots():
    date_string = request.args.get("date", "")

    # group size matters because a slot might fit 30 people but not 40
    total_drivers_string = request.args.get("total_drivers", "1")

    try:
        booking_date = datetime.strptime(date_string, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return fn_error_response("Invalid date format. Use YYYY-MM-DD.")

    # cant book in the past, front-end also disables this but always validate server-side
    if booking_date < date_type.today():
        return fn_error_response("Cannot book in the past.")

    try:
        total_drivers = int(total_drivers_string)
    except (ValueError, TypeError):
         # default to 1 if the parameter was malformed and still gives them sensible results
        total_drivers = 1
    if total_drivers < 1:
        total_drivers = 1

    # how many sessions the booking is for - drives the "too late to start" check for multi-hour bookings
    try:
        sessions = int(request.args.get("sessions", "1"))
    except (ValueError, TypeError):
        sessions = 1
    if sessions < 1:
        sessions = 1

    result = booking_model.fn_get_slots_for_date(mongo, booking_date, total_drivers, sessions)
    return fn_ok_response(result)


@bookings_bp.route("/create-checkout-session", methods=["POST"])
# must be logged in
@fn_login_required

# reserves the slot as a 'reserved' booking, then hands the user to Stripe Checkout to pay
def fn_create_checkout_session():
    # no STRIPE_SECRET_KEY set yet
    if not stripe_service.fn_is_configured():
        return fn_error_response("Payments are not configured. Please contact the venue.", 503)

    # set by /api/auth/login - fn_login_required already guaranteed it exists
    user_id = session["user_id"]
    request_data = request.get_json(silent=True)

    # body wasnt json or was empty - fall back to empty dict so .get() doesn't crash
    if request_data is None:
        request_data = {}

    date_string = request_data.get("date", "")
    time_slot_raw = request_data.get("time_slot")
    adult_count_raw = request_data.get("adult_count", 0)
    junior_count_raw = request_data.get("junior_count", 0)
    package_id = request_data.get("package_id", "")
    extra_rides_raw = request_data.get("extra_rides", 0)

    # date validation
    try:
        booking_date = datetime.strptime(date_string, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return fn_error_response("Invalid date.")

    # never trust the front end - re-check past-date here
    if booking_date < date_type.today():
        return fn_error_response("Cannot book in the past.")

    if time_slot_raw is None:
        return fn_error_response("Please select a time slot.")

    # ensure correct date types
    try:
        time_slot = int(time_slot_raw)
        adult_count = int(adult_count_raw)
        junior_count = int(junior_count_raw)
        extra_rides = int(extra_rides_raw)
    except (ValueError, TypeError):
        return fn_error_response("Invalid booking data.")

    # negative numbers are nonsensical and protects against tampering
    if adult_count < 0 or junior_count < 0:
        return fn_error_response("Driver counts cannot be negative.")

    # cant book with zero drivers
    if adult_count + junior_count < 1:
        return fn_error_response("At least 1 driver is required.")

    # anything outside this is rejected
    valid_packages = {"1_ride", "2_rides", "3_rides", "4_plus"}
    if package_id not in valid_packages:
        return fn_error_response("Please select a valid package.")

    # custom package needs at least 1 extra ride to make sense
    if package_id == "4_plus" and extra_rides < 1:
        return fn_error_response("Please specify at least 1 extra ride for the custom package.")

    # and is capped at 6 sessions total (3 base + 3 extras)
    if package_id == "4_plus" and extra_rides > booking_model.MAX_EXTRA_RIDES:
        return fn_error_response(f"A custom booking can have at most {3 + booking_model.MAX_EXTRA_RIDES} sessions.")

    booking_data = {
        "date": booking_date,
        "time_slot": time_slot,
        "adult_count": adult_count,
        "junior_count": junior_count,
        "package_id": package_id,
        "extra_rides": extra_rides,
    }

    # Create the booking as 'reserved' first - this atomically reserves the slot capacity so nobody can take it
    # while the user is on the Stripe page. 'reserved' (not 'pending') means "held but no payment attempted yet",
    # so these never surface on the dashboard; the webhook flips it to 'paid' once payment is confirmed.
    booking_id, share_token, error = booking_model.fn_create_booking(mongo, user_id, booking_data, payment_status="reserved")
    
    # if model says no it could be slot full, blocked day, etc
    if error is not None:
        return fn_error_response(error)

    total_amount = fn_calculate_total(adult_count, junior_count, package_id, extra_rides)        
    base_url = request.host_url.rstrip("/")
    driver_summary = f"{adult_count} adult{'s' if adult_count != 1 else ''}, {junior_count} junior{'s' if junior_count != 1 else ''}"
    when_summary = f"{booking_date.strftime('%a %d %b %Y')} at {fn_format_hour_label(time_slot)}"

     # for pre-filling the email on the Stripe checkout page
    user_doc = mongo.db.users.find_one({"_id": ObjectId(user_id)})
    customer_email = user_doc.get("email") if user_doc else None

    try:
        checkout_session = stripe_service.fn_create_checkout_session(
            amount_cents=total_amount,
            product_name=f"Awesome Karts - {PACKAGE_LABELS.get(package_id, package_id)}",
            description=f"{driver_summary} - {when_summary}",
            success_url=f"{base_url}/bookings/success?booking_id={booking_id}&token={share_token}",
            cancel_url=f"{base_url}/bookings/cancelled?booking_id={booking_id}",
            customer_email=customer_email,
            metadata={"booking_id": str(booking_id), "user_id": str(user_id)},
        )

    # Stripe call failed, don't leave the slot held by a booking that can never be paid    
    except Exception as stripe_error:
        booking_model.fn_release_pending_booking(mongo, booking_id)
        current_app.logger.error(f"Stripe checkout session creation failed: {stripe_error}")
        return fn_error_response("Could not start payment. Please try again.", 502)

    booking_model.fn_set_checkout_session(mongo, booking_id, checkout_session.id, checkout_session.payment_intent)

    return fn_ok_response({
        "booking_id": booking_id,
        "checkout_url": checkout_session.url,
        "share_token": share_token,
    }, 201)


# called when the user abandons the Stripe page (e.g. browser Back) - frees the slot held by their reserved booking
@bookings_bp.route("/<booking_id>/release", methods=["POST"])
@fn_login_required
def fn_release_reserved_booking(booking_id):
    booking = booking_model.fn_find_booking_by_id(mongo, booking_id)

    # nothing to do if it doesn't exist or already moved past the unpaid hold (paid/cancelled/refunded)
    if booking is None or booking.get("payment_status") not in ("reserved", "pending"):
        return fn_ok_response({"released": False})

    # only let the booking's creator release it
    try:
        is_creator = booking.get("creator_user_id") == ObjectId(session["user_id"])
    except Exception:
        is_creator = False
    if not is_creator:
        return fn_error_response("Booking not found.", 404)

    released = booking_model.fn_release_pending_booking(mongo, booking_id)
    return fn_ok_response({"released": released})


# the success page polls this until payment_status flips to paid
@bookings_bp.route("/<booking_id>/status", methods=["GET"])
def fn_get_booking_status(booking_id):
    booking = booking_model.fn_find_booking_by_id(mongo, booking_id)
    if booking is None:
        return fn_error_response("Booking not found.", 404)

    token = request.args.get("token", "")
    authorized = bool(token and token == booking.get("share_token"))
    if not authorized and "user_id" in session:
        try:
            authorized = ObjectId(session["user_id"]) in booking.get("linked_user_ids", [])
        except Exception:
            authorized = False
    if not authorized:
        return fn_error_response("Booking not found.", 404)

    return fn_ok_response({
        "status": booking.get("payment_status", "pending"),
        "share_token": booking.get("share_token", ""),
        "booking": booking_model.fn_format_booking_for_api(booking, session.get("user_id", "")),
    })

# adds the currently-logged-in user to the booking's linked_user_ids array
@bookings_bp.route("/share/<share_token>/add", methods=["POST"])
@fn_login_required
def fn_add_booking_to_account(share_token):
    user_id = session["user_id"]
    booking = booking_model.fn_find_booking_by_share_token(mongo, share_token)
    if booking is None:
        return fn_error_response("Booking not found.", 404)
    
    # once a booking is cancelled/refunded the share link is dead - nobody else can join it
    if booking.get("payment_status") in ("cancelled", "refunded"):                  
        return fn_error_response("This booking has been cancelled and can no longer be added to an account.")
    booking_model.fn_add_linked_user(mongo, share_token, user_id)
    return fn_ok_response({"message": "Booking added to your account."})
