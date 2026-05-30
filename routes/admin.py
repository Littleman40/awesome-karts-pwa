# our admin panel routes
import re
from datetime import datetime, date as date_type, timedelta

from flask import Blueprint, request, jsonify, session
from bson import ObjectId
from bson.errors import InvalidId

import stripe

from extensions import mongo
from models import booking as booking_model
from models import minor as minor_model
from models import settings as settings_model
from models.booking import fn_format_hour_label, PACKAGE_LABELS
from services import stripe_service
from services import email_service
from utils.auth_decorators import fn_admin_required

# everything an admin frontend talks to lives under /api/admin
admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

# success response, same shape as everywhere else
def fn_ok(data=None, http_status=200):
    if data is None:
        data = {}
    return jsonify({"success": True, "data": data}), http_status

# error response, same shape as everywhere else
def fn_error(message, http_status=400):
    return jsonify({"success": False, "error": message}), http_status


# parses YYYY-MM-DD into a midnight datetime (matches how bookings/slots store dates)
def fn_parse_date_string(date_string):
    if not isinstance(date_string, str) or not date_string:
        return None
    try:
        return datetime.strptime(date_string, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


# tiny user dict for inclusion in booking detail
def fn_format_user_summary(user_doc):
    if not user_doc:
        return None
    return {
        "id": str(user_doc.get("_id", "")),
        "first_name": user_doc.get("first_name", ""),
        "last_name": user_doc.get("last_name", ""),
        "email": user_doc.get("email", ""),
        "phone": user_doc.get("phone", ""),
    }


# one source of truth for the "50 per slot" rule that comes from business_settings
def fn_get_max_capacity():
    settings = settings_model.fn_get_or_create_settings(mongo)
    return settings.get("max_capacity_per_slot", booking_model.MAX_CAPACITY_DEFAULT)


# used by cancel and refund to give the slot capacity back
def fn_decrement_slot_capacity(booking_doc):
    total_drivers = booking_doc.get("total_drivers", 0)
    booking_date = booking_doc.get("date")
    time_slot = booking_doc.get("time_slot")
    if total_drivers > 0 and booking_date is not None and time_slot is not None:
        mongo.db.slots.update_one(
            {"date": booking_date, "hour": time_slot},
            {"$inc": {"booked_count": -total_drivers}},
        )


# converts a mongo booking doc into a json-safe dict for the admin UI; pass creator_user_doc to avoid a second find_one
def fn_format_booking_for_admin(booking_doc, creator_user_doc=None):
    booking_date = booking_doc.get("date")
    if creator_user_doc is None and booking_doc.get("creator_user_id") is not None:
        creator_user_doc = mongo.db.users.find_one({"_id": booking_doc["creator_user_id"]})

    return {
        "id": str(booking_doc["_id"]),
        "ref": str(booking_doc["_id"])[-6:].upper(),
        "date": booking_date.strftime("%Y-%m-%d") if booking_date else "",
        "time_slot": booking_doc.get("time_slot", 0),
        "time_label": fn_format_hour_label(booking_doc.get("time_slot", 0)),
        "adult_count": booking_doc.get("adult_count", 0),
        "junior_count": booking_doc.get("junior_count", 0),
        "total_drivers": booking_doc.get("total_drivers", 0),
        "package_id": booking_doc.get("package_id", ""),
        "package_label": PACKAGE_LABELS.get(booking_doc.get("package_id", ""), ""),
        "extra_rides": booking_doc.get("extra_rides", 0),
        "total_amount": booking_doc.get("total_amount", 0),
        "payment_status": booking_doc.get("payment_status", "pending"),
        "share_token": booking_doc.get("share_token", ""),
        "creator": fn_format_user_summary(creator_user_doc),
        "created_at": booking_doc.get("created_at").isoformat() if booking_doc.get("created_at") else "",
    }


@admin_bp.route("/bookings/by-date", methods=["GET"])
@fn_admin_required
def fn_get_bookings_by_date():
    target_date = fn_parse_date_string(request.args.get("date"))
    if target_date is None:
        return fn_error("Please provide ?date=YYYY-MM-DD.")

    settings = settings_model.fn_get_or_create_settings(mongo)
    opening_hours = settings.get("opening_hours", settings_model.DEFAULT_OPENING_HOURS)
    weekday_key = target_date.strftime("%A").lower()
    day_hours = opening_hours.get(weekday_key)

    # day-wide block surfaces in the response so the UI can show a warning banner
    blocked_day_doc = mongo.db.blocked_days.find_one({"date": target_date})

    # closed for the day; no hours to show
    if day_hours is None:
        return fn_ok({
            "date": target_date.strftime("%Y-%m-%d"),
            "weekday": weekday_key,
            "is_day_blocked": blocked_day_doc is not None,
            "blocked_reason": (blocked_day_doc.get("reason", "") if blocked_day_doc else ""),
            "hours": [],
        })

    hours_in_day = list(range(day_hours["open"], day_hours["close"]))

    # fetch ALL bookings on this date in one query, then bucket by hour client-side
    booking_docs = list(mongo.db.bookings.find({                                
        "date": target_date,
        "time_slot": {"$in": hours_in_day},
    }).sort("time_slot", 1))

    creator_ids = list({b["creator_user_id"] for b in booking_docs if b.get("creator_user_id")})
    
    # batch fetch creator users for efficiency
    creators_by_id = {}                                                         
    if creator_ids:
        for user_doc in mongo.db.users.find({"_id": {"$in": creator_ids}}):
            creators_by_id[user_doc["_id"]] = user_doc

    bookings_by_hour = {hour: [] for hour in hours_in_day}
    for booking_doc in booking_docs:
        creator = creators_by_id.get(booking_doc.get("creator_user_id"))
        bookings_by_hour.setdefault(booking_doc.get("time_slot"), []).append(
            fn_format_booking_for_admin(booking_doc, creator),
        )

    # hour -> {is_blocked, blocked_reason} so the settings page can render per-hour block buttons
    slot_blocked_lookup = {}                                                    
    for slot_doc in mongo.db.slots.find({"date": target_date}):
        slot_blocked_lookup[slot_doc.get("hour")] = {
            "is_blocked": slot_doc.get("is_blocked", False),
            "blocked_reason": slot_doc.get("blocked_reason", ""),
        }

    max_capacity = fn_get_max_capacity()
    hours_payload = []
    for hour in hours_in_day:
        hour_bookings = bookings_by_hour.get(hour, [])
        
        # sum drivers across active bookings only - cancelled/refunded don't count toward the hour total
        drivers_total = sum(                                                    
            b.get("total_drivers", 0) for b in hour_bookings
            if b.get("payment_status") not in ("cancelled", "refunded")
        )
        slot_block_info = slot_blocked_lookup.get(hour, {"is_blocked": False, "blocked_reason": ""})
        hours_payload.append({
            "hour": hour,
            "label": fn_format_hour_label(hour),
            "drivers_total": drivers_total,
            "max_capacity": max_capacity,
            "is_blocked": slot_block_info["is_blocked"],
            "blocked_reason": slot_block_info["blocked_reason"],
            "bookings": hour_bookings,
        })

    return fn_ok({
        "date": target_date.strftime("%Y-%m-%d"),
        "weekday": weekday_key,
        "is_day_blocked": blocked_day_doc is not None,
        "blocked_reason": (blocked_day_doc.get("reason", "") if blocked_day_doc else ""),
        "hours": hours_payload,
    })


# manual booking, admin specifies the customer by email, payment is marked paid immediately
@admin_bp.route("/bookings/create", methods=["POST"])                           
@fn_admin_required
def fn_create_booking_manually():
    request_data = request.get_json(silent=True)
    if request_data is None:
        request_data = {}

    customer_email = (request_data.get("customer_email") or "").strip().lower()
    if not customer_email:
        return fn_error("Customer email is required.")
    
    # the booking is linked to an existing account
    customer_user = mongo.db.users.find_one({"email": customer_email})          
    if customer_user is None:
        return fn_error("No user found with that email. The customer must register first.")

    try:
        booking_date = datetime.strptime(request_data.get("date", ""), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return fn_error("Invalid booking date.")

    try:
        time_slot = int(request_data.get("time_slot"))
        adult_count = int(request_data.get("adult_count", 0))
        junior_count = int(request_data.get("junior_count", 0))
        extra_rides = int(request_data.get("extra_rides", 0))
    except (ValueError, TypeError):
        return fn_error("Invalid booking data.")

    if adult_count < 0 or junior_count < 0:
        return fn_error("Driver counts cannot be negative.")
    if adult_count + junior_count < 1:
        return fn_error("At least 1 driver is required.")

    package_id = request_data.get("package_id", "")
    valid_packages = {"1_ride", "2_rides", "3_rides", "4_plus"}
    if package_id not in valid_packages:
        return fn_error("Please select a valid package.")
    if package_id == "4_plus" and extra_rides < 1:
        return fn_error("Please specify at least 1 extra ride for the custom package.")

    # delegate the heavy lifting to the booking model
    booking_payload = {                                                         
        "date": booking_date,
        "time_slot": time_slot,
        "adult_count": adult_count,
        "junior_count": junior_count,
        "package_id": package_id,
        "extra_rides": extra_rides,
    }
    booking_id, share_token, error_message = booking_model.fn_create_booking(
        mongo,
        str(customer_user["_id"]),
        booking_payload,
    )
    if error_message is not None:
        return fn_error(error_message)

    # let the customer know a booking was created for them - fire-and-forget
    try:
        created_booking_doc = booking_model.fn_find_booking_by_id(mongo, booking_id)
        if created_booking_doc is not None:
            email_service.fn_send_admin_created_booking(created_booking_doc, customer_user)
    except Exception as admin_created_email_error:
        from flask import current_app
        current_app.logger.warning(f"Admin-created booking email failed for {booking_id}: {admin_created_email_error}")

    return fn_ok({
        "booking_id": booking_id,
        "share_token": share_token,
        "share_url": f"/bookings/share/{share_token}",
    }, 201)


@admin_bp.route("/bookings/<booking_id_string>", methods=["GET"])
@fn_admin_required
def fn_get_booking_detail(booking_id_string):
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return fn_error("Booking not found.", 404)
    booking_doc = mongo.db.bookings.find_one({"_id": booking_object_id})
    if booking_doc is None:
        return fn_error("Booking not found.", 404)

    linked_user_summaries = []
    for linked_user_id in booking_doc.get("linked_user_ids", []):
        linked_user_doc = mongo.db.users.find_one({"_id": linked_user_id})
        if linked_user_doc is not None:
            linked_user_summaries.append(fn_format_user_summary(linked_user_doc))

    formatted_booking = fn_format_booking_for_admin(booking_doc)
    formatted_booking["linked_users"] = linked_user_summaries
    return fn_ok(formatted_booking)


@admin_bp.route("/bookings/<booking_id_string>/cancel", methods=["POST"])
@fn_admin_required
def fn_cancel_booking(booking_id_string):
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return fn_error("Booking not found.", 404)
    booking_doc = mongo.db.bookings.find_one({"_id": booking_object_id})
    if booking_doc is None:
        return fn_error("Booking not found.", 404)
    current_status = booking_doc.get("payment_status", "")
    if current_status in ("cancelled", "refunded"):
        return fn_ok({"already": current_status})

    mongo.db.bookings.update_one({"_id": booking_object_id}, {"$set": {"payment_status": "cancelled"}})
    fn_decrement_slot_capacity(booking_doc)

    # notify the booking creator only - fire-and-forget so a send failure never blocks the cancellation
    try:
        creator_user = mongo.db.users.find_one({"_id": booking_doc.get("creator_user_id")})
        if creator_user is not None:
            email_service.fn_send_booking_cancelled(booking_doc, creator_user, was_paid=(current_status == "paid"))
    except Exception as cancel_email_error:
        from flask import current_app
        current_app.logger.warning(f"Cancellation email failed for booking {booking_id_string}: {cancel_email_error}")

    return fn_ok({"status": "cancelled"})


@admin_bp.route("/bookings/<booking_id_string>/refund", methods=["POST"])
@fn_admin_required
def fn_refund_booking(booking_id_string):
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return fn_error("Booking not found.", 404)
    booking_doc = mongo.db.bookings.find_one({"_id": booking_object_id})
    if booking_doc is None:
        return fn_error("Booking not found.", 404)
    current_status = booking_doc.get("payment_status", "")
    if current_status in ("cancelled", "refunded"):
        return fn_ok({"already": current_status})
    
    # can only refund money that was actually captured
    if current_status != "paid":
        return fn_error("Only paid bookings can be refunded.")

    payment_intent_id = booking_doc.get("stripe_payment_id")
    # real Stripe refund - reverses the test-mode charge
    if stripe_service.fn_is_configured() and payment_intent_id:
        try:
            stripe_service.fn_create_refund(payment_intent_id)

        # Stripe rejected the refundtus
        except stripe.error.StripeError as refund_error:
            return fn_error(f"Stripe refund failed: {getattr(refund_error, 'user_message', None) or str(refund_error)}")

    mongo.db.bookings.update_one(
        {"_id": booking_object_id},
        {"$set": {"payment_status": "refunded", "refunded_at": datetime.utcnow()}},
    )
    fn_decrement_slot_capacity(booking_doc)

    # confirm the refund to the booking creator - only reached after the Stripe refund succeeded
    try:
        creator_user = mongo.db.users.find_one({"_id": booking_doc.get("creator_user_id")})
        if creator_user is not None:
            email_service.fn_send_refund_confirmation(booking_doc, creator_user)
    except Exception as refund_email_error:
        from flask import current_app
        current_app.logger.warning(f"Refund email failed for booking {booking_id_string}: {refund_email_error}")

    return fn_ok({"status": "refunded"})



# converts an admin search token (with optional *) into an anchored case-insensitive regex
def fn_build_pattern_from_user_input(user_input):
    user_input = (user_input or "").strip()
    if not user_input:
        return None
    escaped = re.escape(user_input)
    pattern_with_wildcards = escaped.replace(r"\*", ".*")
    return "^" + pattern_with_wildcards + "$"


@admin_bp.route("/customers", methods=["GET"])
@fn_admin_required
def fn_search_customers():
    query_text = (request.args.get("q") or "").strip()

    # empty query returns nothing - admin must search deliberately
    if not query_text:
        return fn_ok({"customers": [], "count": 0, "mode": "empty"})

    mongo_filter = None
    search_mode = ""

    # "first, last" mode - case-insensitive, wildcard supported on each side
    if "," in query_text:
        first_part, _, last_part = query_text.partition(",")
        first_pattern = fn_build_pattern_from_user_input(first_part)
        last_pattern  = fn_build_pattern_from_user_input(last_part)
        if first_pattern is None and last_pattern is None:
            return fn_error("Please enter a first or last name.")
        conditions = []
        if first_pattern is not None:
            conditions.append({"first_name": {"$regex": first_pattern, "$options": "i"}})
        if last_pattern is not None:
            conditions.append({"last_name":  {"$regex": last_pattern, "$options": "i"}})
        mongo_filter = {"$and": conditions} if len(conditions) > 1 else conditions[0]
        search_mode = "name"

    # email mode - wildcard supported, anchored, case-insensitive
    elif "@" in query_text:
        email_pattern = fn_build_pattern_from_user_input(query_text.lower())
        mongo_filter = {"email": {"$regex": email_pattern, "$options": "i"}}
        search_mode = "email"

    # single-token mode - match first_name OR last_name
    else:
        single_pattern = fn_build_pattern_from_user_input(query_text)
        mongo_filter = {"$or": [
            {"first_name": {"$regex": single_pattern, "$options": "i"}},
            {"last_name":  {"$regex": single_pattern, "$options": "i"}},
        ]}
        search_mode = "name"

    user_docs = list(mongo.db.users.find(mongo_filter).sort([("last_name", 1), ("first_name", 1)]).limit(100))

    customer_summaries = []
    for user_doc in user_docs:
        dob_value = user_doc.get("dob")
        customer_summaries.append({
            "id": str(user_doc["_id"]),
            "first_name": user_doc.get("first_name", ""),
            "last_name": user_doc.get("last_name", ""),
            "email": user_doc.get("email", ""),
            "phone": user_doc.get("phone", ""),
            "dob": dob_value.strftime("%Y-%m-%d") if dob_value else "",
        })

    return fn_ok({"customers": customer_summaries, "count": len(customer_summaries), "mode": search_mode})


@admin_bp.route("/customers/<user_id_string>", methods=["GET"])
@fn_admin_required
def fn_get_customer_profile(user_id_string):
    try:
        user_object_id = ObjectId(user_id_string)
    except (InvalidId, TypeError):
        return fn_error("Customer not found.", 404)
    user_doc = mongo.db.users.find_one({"_id": user_object_id})
    if user_doc is None:
        return fn_error("Customer not found.", 404)

    # all bookings this user is linked to (created OR shared)
    user_bookings_docs = list(mongo.db.bookings.find(                           
        {"linked_user_ids": user_object_id}
    ).sort([("date", -1), ("time_slot", -1)]))
    formatted_bookings = [fn_format_booking_for_admin(b) for b in user_bookings_docs]

    minors_docs = list(mongo.db.minors.find({"user_id": user_object_id}))
    formatted_minors = [minor_model.fn_format_minor_for_api(m) for m in minors_docs]

    user_dob = user_doc.get("dob")
    user_waiver_at = user_doc.get("waiver_accepted_at")
    user_created_at = user_doc.get("created_at")

    return fn_ok({
        "id": str(user_doc["_id"]),
        "first_name": user_doc.get("first_name", ""),
        "last_name":  user_doc.get("last_name", ""),
        "gender":     user_doc.get("gender", ""),
        "dob":        user_dob.strftime("%Y-%m-%d") if user_dob else None,
        "address":    user_doc.get("address", ""),
        "phone":      user_doc.get("phone", ""),
        "email":      user_doc.get("email", ""),
        "created_at": user_created_at.isoformat() if user_created_at else "",
        "waiver_accepted":    user_doc.get("waiver_accepted", False),
        "waiver_accepted_at": user_waiver_at.isoformat() if user_waiver_at else None,
        "bookings": formatted_bookings,
        "minors": formatted_minors,
    })



@admin_bp.route("/days", methods=["GET"])
@fn_admin_required
def fn_get_days_overview():
    from_date = fn_parse_date_string(request.args.get("from"))
    if from_date is None:
        from_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    to_date = fn_parse_date_string(request.args.get("to"))
    
    # default 2-month window for the settings calendar
    if to_date is None:
        to_date = from_date + timedelta(days=60)

    blocked_day_lookup = {}
    for blocked_day_doc in mongo.db.blocked_days.find({
        "date": {"$gte": from_date, "$lt": to_date + timedelta(days=1)},
    }):
        date_key = blocked_day_doc["date"].strftime("%Y-%m-%d")
        blocked_day_lookup[date_key] = blocked_day_doc.get("reason", "")

    days_result = []
    cursor_date = from_date
    while cursor_date <= to_date:
        date_key = cursor_date.strftime("%Y-%m-%d")
        days_result.append({
            "date": date_key,
            "is_blocked": date_key in blocked_day_lookup,
            "blocked_reason": blocked_day_lookup.get(date_key, ""),
        })
        cursor_date = cursor_date + timedelta(days=1)

    return fn_ok({"days": days_result})


@admin_bp.route("/days/block", methods=["POST"])
@fn_admin_required
def fn_block_day():
    request_data = request.get_json(silent=True) or {}
    target_date = fn_parse_date_string(request_data.get("date"))
    if target_date is None:
        return fn_error("Invalid date.")
    reason = (request_data.get("reason") or "").strip()

    # upsert so calling block twice doesn't create duplicate rows
    mongo.db.blocked_days.update_one(
        {"date": target_date},
        {"$set": {"date": target_date, "reason": reason}},
        upsert=True,
    )
    return fn_ok({"date": target_date.strftime("%Y-%m-%d"), "blocked": True})


@admin_bp.route("/days/unblock", methods=["POST"])
@fn_admin_required
def fn_unblock_day():
    request_data = request.get_json(silent=True) or {}
    target_date = fn_parse_date_string(request_data.get("date"))
    if target_date is None:
        return fn_error("Invalid date.")
    mongo.db.blocked_days.delete_one({"date": target_date})
    return fn_ok({"date": target_date.strftime("%Y-%m-%d"), "blocked": False})


@admin_bp.route("/slots/block", methods=["POST"])
@fn_admin_required
def fn_block_slot():
    request_data = request.get_json(silent=True) or {}
    target_date = fn_parse_date_string(request_data.get("date"))
    if target_date is None:
        return fn_error("Invalid date.")
    try:
        hour = int(request_data.get("hour"))
    except (TypeError, ValueError):
        return fn_error("Invalid hour.")
    if not (0 <= hour <= 23):
        return fn_error("Hour must be between 0 and 23.")
    reason = (request_data.get("reason") or "").strip()
    
    # upsert - if no slot doc exists yet we create one as blocked with zero bookings
    mongo.db.slots.update_one(
        {"date": target_date, "hour": hour},
        {"$set": {"is_blocked": True, "blocked_reason": reason},
         "$setOnInsert": {"booked_count": 0}},
        upsert=True,
    )
    return fn_ok({"date": target_date.strftime("%Y-%m-%d"), "hour": hour, "blocked": True})


@admin_bp.route("/slots/unblock", methods=["POST"])
@fn_admin_required
def fn_unblock_slot():
    request_data = request.get_json(silent=True) or {}
    target_date = fn_parse_date_string(request_data.get("date"))
    if target_date is None:
        return fn_error("Invalid date.")
    try:
        hour = int(request_data.get("hour"))
    except (TypeError, ValueError):
        return fn_error("Invalid hour.")
    mongo.db.slots.update_one(
        {"date": target_date, "hour": hour},
        {"$set": {"is_blocked": False, "blocked_reason": ""}},
    )
    return fn_ok({"date": target_date.strftime("%Y-%m-%d"), "hour": hour, "blocked": False})


@admin_bp.route("/settings", methods=["GET"])
@fn_admin_required
def fn_get_settings():
    current_settings = settings_model.fn_get_or_create_settings(mongo)
    return fn_ok(settings_model.fn_format_settings_for_api(current_settings))


@admin_bp.route("/settings", methods=["PUT"])
@fn_admin_required
def fn_update_settings():
    request_data = request.get_json(silent=True)
    if not isinstance(request_data, dict):
        return fn_error("Request body must be a JSON object.")
    updated_settings, error_message = settings_model.fn_update_settings(mongo, request_data)
    if error_message is not None:
        return fn_error(error_message)
    return fn_ok(settings_model.fn_format_settings_for_api(updated_settings))
