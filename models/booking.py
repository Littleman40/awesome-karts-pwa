from datetime import datetime, date as date_type
from bson import ObjectId
import secrets
from pymongo.errors import DuplicateKeyError

DEFAULT_OPENING_HOURS = {                                                       # default opening hours - will be overriden by admin settings when its setup
    "monday":    {"open": 10, "close": 20},
    "tuesday":   {"open": 10, "close": 20},
    "wednesday": {"open": 10, "close": 20},
    "thursday":  {"open": 10, "close": 20},
    "friday":    {"open": 10, "close": 22},
    "saturday":  {"open":  9, "close": 22},
    "sunday":    {"open":  9, "close": 20},
}

MAX_CAPACITY_DEFAULT = 50

PACKAGE_LABELS = {                                                              # labels used when rendering bookings back to the user
    "1_ride":  "1 Ride",
    "2_rides": "2 Rides",
    "3_rides": "3 Rides",
    "4_plus":  "4+ Rides",
}


def fn_get_business_settings(mongo):                                            # fetches the single business_settings document, or returns hard-coded defaults if none exists yet
    settings = mongo.db.business_settings.find_one({})
    if settings is None:                                                        # admin hasnt set anything yet - fall back to defaults so the site still works
        settings = {
            "opening_hours": DEFAULT_OPENING_HOURS,
            "max_capacity_per_slot": MAX_CAPACITY_DEFAULT,
            "pricing": {"1_ride": 3750, "2_rides": 6500, "3_rides": 8500, "extra_ride": 2000},   # prices are stored in cents
        }
    return settings


def fn_ensure_booking_indexes(mongo):                                           # called once on app startup from app.py to set up db indexes
    mongo.db.slots.create_index([("date", 1), ("hour", 1)], unique=True)        # a slot is uniquely identified by (date, hour)-— unique index prevents two slot docs for the same time
    mongo.db.bookings.create_index("share_token", unique=True, sparse=True)     # share_token must be unique so each link points to one booking. sparse=True means docs without a token are ignored


def fn_format_hour_label(hour):                                                 # converts a 24-hr time into a 12-hr time
    if hour == 0:
        return "12:00 AM"
    elif hour < 12:
        return f"{hour}:00 AM"
    elif hour == 12:
        return "12:00 PM"
    else:
        return f"{hour - 12}:00 PM"


def fn_calculate_total(adult_count, junior_count, package_id, extra_rides=0):   # works out total booking price in cents
    total_drivers = adult_count + junior_count                                  # everyone (adult + junior) pays the same per-person price for the package
    if package_id == "1_ride":
        per_person = 3750                                                       # $37.50
    elif package_id == "2_rides":
        per_person = 6500                                                       # $65.00
    elif package_id == "3_rides":
        per_person = 8500                                                       # $85.00
    elif package_id == "4_plus":
        per_person = 8500 + (extra_rides * 2000)                                # custom package: 3 rides base + $20 per extra ride
    else:
        return None                                                             # unknown package id / caller will treat None as a validation error
    return total_drivers * per_person


def fn_get_slot_status(booked_count, requested_drivers, max_capacity, is_blocked):  # returns one of: "blocked", "booked_out", "low", "medium", "high"
    if is_blocked:                                                              # admin manually blocked this slot
        return "blocked"
    if booked_count + requested_drivers > max_capacity:                         # not enough room for *this users group* even though slot itself isn't full
        return "booked_out"
    if booked_count >= max_capacity:                                            # slot is at capacity for anyone
        return "booked_out"
    pct = (booked_count / max_capacity) * 100                                   # how full is the slot? drives green/yellow/red bars
    if pct <= 50:
        return "low"                                                            # green
    elif pct <= 80:
        return "medium"                                                         # yellow
    return "high"                                                               # red


def fn_get_slots_for_date(mongo, booking_date, total_drivers):                  # builds the list of selectable time slots for a given calendar date
    settings = fn_get_business_settings(mongo)
    max_capacity = settings.get("max_capacity_per_slot", MAX_CAPACITY_DEFAULT)
    booking_datetime = datetime.combine(booking_date, datetime.min.time())      # convert date to a midnight datetime

    blocked_day = mongo.db.blocked_days.find_one({"date": booking_datetime})    # is the entire day blocked check
    if blocked_day is not None:
        return {"blocked": True, "reason": blocked_day.get("reason", ""), "slots": []}

    day_name = booking_date.strftime("%A").lower()
    opening_hours = settings.get("opening_hours", DEFAULT_OPENING_HOURS)
    day_hours = opening_hours.get(day_name)
    if day_hours is None:                                                       # closed all day on this weekday
        return {"blocked": True, "reason": "Closed today", "slots": []}

    open_hour = day_hours["open"]
    close_hour = day_hours["close"]
    hours = list(range(open_hour, close_hour))                                  # eg open=10 close=20 -> [10,11,...,19]

    slot_records = list(mongo.db.slots.find({                                   # fetch any existing slot docs for these hours in one query
        "date": booking_datetime,
        "hour": {"$in": hours},
    }))

    slot_map = {}                                                               # build hour -> slot_doc lookup so we don't have to search the list per hour
    for slot_record in slot_records:
        slot_map[slot_record["hour"]] = slot_record

    result_slots = []
    for hour in hours:
        slot_record = slot_map.get(hour)
        booked_count = 0                                                        # default: no one booked this hour yet
        is_slot_blocked = False
        if slot_record is not None:                                             # slot doc exists → read real values
            booked_count = slot_record.get("booked_count", 0)
            is_slot_blocked = slot_record.get("is_blocked", False)
        status = fn_get_slot_status(booked_count, total_drivers, max_capacity, is_slot_blocked)
        result_slots.append({
            "hour": hour,
            "label": fn_format_hour_label(hour),                                # human readable for the UI
            "status": status,                                                   # used by front-end to pick colour/disabled state
            "booked_count": booked_count,
        })

    return {"blocked": False, "slots": result_slots}


def fn_attempt_slot_booking(mongo, booking_datetime, time_slot, total_drivers, max_capacity):   # reserves capacity in a slot for a booking - so two simultaneous bookings can't both take the last spot when only one should be left
    result = mongo.db.slots.update_one(
        {
            "date": booking_datetime,
            "hour": time_slot,
            "is_blocked": {"$ne": True},                                                        # never book an admin-blocked slot
            "$expr": {"$lte": [{"$add": ["$booked_count", total_drivers]}, max_capacity]},      # only match if booked_count + this group fits within capacity (server-side check, atomic)
        },
        {"$inc": {"booked_count": total_drivers}},                                              # if filter matched, automatically add this group's drivers to booked_count
    )

    if result.matched_count > 0:                                                                # existing slot doc was updated successfully
        return True, None

    existing_slot = mongo.db.slots.find_one({"date": booking_datetime, "hour": time_slot})      # the update didn't match- either the slot doc doesn't exist yet, or it does exist but is now full/blocked
    if existing_slot is not None:                                                               # doc exists but conditions failed → slot is full or blocked
        return False, "This slot is no longer available."

    try:                                                                                        # no slot doc exists for this hour yet / try to create one with our group already counted
        mongo.db.slots.insert_one({
            "date": booking_datetime,
            "hour": time_slot,
            "booked_count": total_drivers,
            "is_blocked": False,
        })
        return True, None
    except DuplicateKeyError:                                                                   # someone else inserted a slot for this hour between our find and our insert - we try to do the update once more but otherwise just return error
        result2 = mongo.db.slots.update_one(
            {
                "date": booking_datetime,
                "hour": time_slot,
                "is_blocked": {"$ne": True},
                "$expr": {"$lte": [{"$add": ["$booked_count", total_drivers]}, max_capacity]},
            },
            {"$inc": {"booked_count": total_drivers}},
        )
        if result2.matched_count > 0:
            return True, None
        return False, "This slot is no longer available."
    except Exception:
        return False, "Could not reserve this slot. Please try again."                          # any other db error


def fn_create_booking(mongo, user_id_string, booking_data):                                     # make booking function
    booking_date = booking_data["date"]
    time_slot = booking_data["time_slot"]
    adult_count = booking_data["adult_count"]
    junior_count = booking_data["junior_count"]
    package_id = booking_data["package_id"]
    extra_rides = booking_data.get("extra_rides", 0)

    total_drivers = adult_count + junior_count
    total_amount = fn_calculate_total(adult_count, junior_count, package_id, extra_rides)
    if total_amount is None:                                                                    # fn_calculate_total returns None for unknown package
        return None, None, "Invalid package."

    settings = fn_get_business_settings(mongo)
    max_capacity = settings.get("max_capacity_per_slot", MAX_CAPACITY_DEFAULT)
    opening_hours = settings.get("opening_hours", DEFAULT_OPENING_HOURS)

    day_name = booking_date.strftime("%A").lower()                                              # check the requested hour falls within opening hours for that weekday, protects against someone calling the api directly with a bad hour
    day_hours = opening_hours.get(day_name)
    if day_hours is None or time_slot < day_hours["open"] or time_slot >= day_hours["close"]:
        return None, None, "This time slot is outside opening hours."

    booking_datetime = datetime.combine(booking_date, datetime.min.time())                      # date -> midnight datetime

    blocked_day = mongo.db.blocked_days.find_one({"date": booking_datetime})                    # double-check the day isn't blocked
    if blocked_day is not None:
        return None, None, "This date is not available for bookings."

    ok, slot_error = fn_attempt_slot_booking(mongo, booking_datetime, time_slot, total_drivers, max_capacity)
    if not ok:                                                                                  # capacity was already taken, abort, no booking was created
        return None, None, slot_error

    user_object_id = ObjectId(user_id_string)                                                   # convert session string id into mongo's ObjectId
    share_token = secrets.token_urlsafe(16)                                                     # unguessable 16-byte url-safe token → e.g. "k3Hg2-jq..." used in /bookings/share/<token>

    booking_doc = {
        "creator_user_id": user_object_id,                                                      # the logged-in user who paid/created the booking
        "linked_user_ids": [user_object_id],                                                    # everyone whose dashboard this booking shows up on
        "date": booking_datetime,                                                               # midnight of the booking day
        "time_slot": time_slot,                                                                 # hour 0-23
        "adult_count": adult_count,
        "junior_count": junior_count,
        "total_drivers": total_drivers, 
        "package_id": package_id,
        "extra_rides": extra_rides, 
        "total_amount": total_amount,   
        "payment_status": "paid",   
        "stripe_payment_id": None,  
        "share_token": share_token,
        "created_at": datetime.utcnow(),                                                        # UTC timestamp; templates convert to AEST/AEDT for display
    }

    insert_result = mongo.db.bookings.insert_one(booking_doc)
    return str(insert_result.inserted_id), share_token, None                                    # returns these to the front end so it can show the confirmation + share link


def fn_find_booking_by_share_token(mongo, share_token):                                         # looks up a booking by its share token used by the public /bookings/share/<token> page
    return mongo.db.bookings.find_one({"share_token": share_token})


def fn_get_user_upcoming_bookings(mongo, user_id_string):                                       # returns all bookings the user is linked to (created or shared with) that are on/after today
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:                                                                           # error handling
        return []
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)                # midnight today UTC
    return list(
        mongo.db.bookings.find({
            "linked_user_ids": user_object_id,                                                  # match if user appears in linked_user_ids (covers both "I created this" and "someone shared this with me")
            "date": {"$gte": today},                                                            # only future / today bookings
        }).sort("date", 1)                                                                      # soonest first
    )


def fn_add_linked_user(mongo, share_token, user_id_string):                                     # adds the current user to a booking's linked_user_ids, called when someone clicks "Add to my account" on a share page
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return False
    result = mongo.db.bookings.update_one(
        {"share_token": share_token},
        {"$addToSet": {"linked_user_ids": user_object_id}},                                     # $addToSet (vs $push) prevents duplicates in the array
    )
    return result.matched_count > 0                                                             # True if a booking with that share_token existed


def fn_format_booking_for_api(booking, current_user_id_string):                                 # converts a mongo booking doc into a json-safe dict to send to the front end
    creator_id = str(booking.get("creator_user_id", ""))
    is_creator = creator_id == current_user_id_string
    booking_date = booking.get("date")
    date_str = booking_date.strftime("%Y-%m-%d") if booking_date else ""                        # iso-style date string is easiest to parse in javascript
    time_slot = booking.get("time_slot", 0)
    created_at = booking.get("created_at")
    return {
        "id": str(booking["_id"]),
        "ref": str(booking["_id"])[-6:].upper(),                                                # short 6-char human-friendly reference (last 6 chars of the ObjectId)
        "date": date_str,
        "time_slot": time_slot,
        "time_label": fn_format_hour_label(time_slot),
        "adult_count": booking.get("adult_count", 0),
        "junior_count": booking.get("junior_count", 0),
        "total_drivers": booking.get("total_drivers", 0),
        "package_id": booking.get("package_id", ""),
        "package_label": PACKAGE_LABELS.get(booking.get("package_id", ""), ""),
        "extra_rides": booking.get("extra_rides", 0),
        "total_amount": booking.get("total_amount", 0),
        "payment_status": booking.get("payment_status", "pending"),
        "share_token": booking.get("share_token", ""),
        "is_creator": is_creator,
        "created_at": created_at.isoformat() if created_at else "",
    }
