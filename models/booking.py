# booking model - slot availability, booking creation, and booking queries
from datetime import datetime, date as date_type, timedelta
from bson import ObjectId
from bson.errors import InvalidId
import secrets
from pymongo.errors import DuplicateKeyError

from models.settings import fn_get_or_create_settings, DEFAULT_OPENING_HOURS

# max number of drivers that can book each hour - used as fallback if settings doc is missing
MAX_CAPACITY_DEFAULT = 50

# labels used when rendering bookings back to the user
PACKAGE_LABELS = {
    "1_ride":  "1 Ride",
    "2_rides": "2 Rides",
    "3_rides": "3 Rides",
    "4_plus":  "4+ Rides",
}


# called once on app startup from app.py to set up db indexes
def fn_ensure_booking_indexes(mongo):

    # a slot is uniquely identified by (date, hour)- unique index prevents two slot docs for the same time
    mongo.db.slots.create_index([("date", 1), ("hour", 1)], unique=True)

    # share_token must be unique so each link points to one booking. sparse=True means docs without a token are ignored
    mongo.db.bookings.create_index("share_token", unique=True, sparse=True)


# converts a 24-hr time into a 12-hr time
def fn_format_hour_label(hour):
    if hour == 0:
        return "12:00 AM"
    elif hour < 12:
        return f"{hour}:00 AM"
    elif hour == 12:
        return "12:00 PM"
    else:
        return f"{hour - 12}:00 PM"


# works out total booking price in cents
def fn_calculate_total(adult_count, junior_count, package_id, extra_rides=0):
    total_drivers = adult_count + junior_count
    if package_id == "1_ride":
        per_person = 3750
    elif package_id == "2_rides":
        per_person = 6500
    elif package_id == "3_rides":
        per_person = 8500
    elif package_id == "4_plus":
        per_person = 8500 + (extra_rides * 2000)
    else:
        return None
    return total_drivers * per_person

# returns one of: "blocked", "booked_out", "low", "medium", "high" to the hourly cards on the booking page
def fn_get_slot_status(booked_count, requested_drivers, max_capacity, is_blocked):
    
    # admin manually blocked this slot
    if is_blocked:
        return "blocked"
    
    # not enough room for this group even though slot itself isn't full
    if booked_count + requested_drivers > max_capacity:
        return "booked_out"
    
    # slot is at capacity for anyone
    if booked_count >= max_capacity:
        return "booked_out"
    
    # how full is the slot? drives green/yellow/red bars
    pct = (booked_count / max_capacity) * 100
    if pct <= 50:
        return "low"        # green bars
    elif pct <= 80:
        return "medium"     # yellow bars
    return "high"           # red bars


# builds the list of selectable time slots for a given calendar date
def fn_get_slots_for_date(mongo, booking_date, total_drivers):
    settings = fn_get_or_create_settings(mongo)
    max_capacity = settings.get("max_capacity_per_slot", MAX_CAPACITY_DEFAULT)

    # convert date to a midnight datetime, eg 00:00:00 for start of day etc
    booking_datetime = datetime.combine(booking_date, datetime.min.time())

    # is the entire day blocked check   
    blocked_day = mongo.db.blocked_days.find_one({"date": booking_datetime})
    if blocked_day is not None:
        return {"blocked": True, "reason": blocked_day.get("reason", ""), "slots": []}

    day_name = booking_date.strftime("%A").lower()
    opening_hours = settings.get("opening_hours", DEFAULT_OPENING_HOURS)
    day_hours = opening_hours.get(day_name)
    
    # closed all day on this weekday
    if day_hours is None:
        return {"blocked": True, "reason": "Closed today", "slots": []}

    open_hour = day_hours["open"]
    close_hour = day_hours["close"]

    # eg open=10 close=20 -> [10,11,...,19]
    hours = list(range(open_hour, close_hour))

    # fetch any existing slot docs for these hours in one query
    slot_records = list(mongo.db.slots.find({
        "date": booking_datetime,
        "hour": {"$in": hours},
    }))

    # build the hour, slot_doc lookup so we don't have to search the list per hour
    slot_map = {}
    for slot_record in slot_records:
        slot_map[slot_record["hour"]] = slot_record

    result_slots = []
    for hour in hours:
        slot_record = slot_map.get(hour)

        # default: no one booked this hour yet
        booked_count = 0                                                        
        is_slot_blocked = False

        # slot doc exists then we read real values
        if slot_record is not None:                                             
            booked_count = slot_record.get("booked_count", 0)
            is_slot_blocked = slot_record.get("is_blocked", False)
        status = fn_get_slot_status(booked_count, total_drivers, max_capacity, is_slot_blocked)
        result_slots.append({
            "hour": hour,
            "label": fn_format_hour_label(hour),    # human readable for the UI
            "status": status,                       # used by front-end to pick colour/disabled state
            "booked_count": booked_count,
        })

    return {"blocked": False, "slots": result_slots}


# reserves capacity in a slot for a booking so two simultaneous bookings can't both take the last spot when only one should be left
def fn_attempt_slot_booking(mongo, booking_datetime, time_slot, total_drivers, max_capacity):
    result = mongo.db.slots.update_one(
        {
            "date": booking_datetime,
            "hour": time_slot,

            # never book an admin-blocked slot 
            "is_blocked": {"$ne": True},

            # only match if booked_count + this group fits within capacity, which is a server sided check      
            "$expr": {"$lte": [{"$add": ["$booked_count", total_drivers]}, max_capacity]},
        },

        # if filter matched, automatically add this group's drivers to booked_count
        {"$inc": {"booked_count": total_drivers}},
    )

    # existing slot doc was updated successfully
    if result.matched_count > 0:
        return True, None

    # the update didn't match so either the slot doc doesn't exist yet, or it does exist but is now full/blocked
    existing_slot = mongo.db.slots.find_one({"date": booking_datetime, "hour": time_slot})
    
    # doc exists but conditions failed so therefor slot is full or blocked
    if existing_slot is not None:
        return False, "This slot is no longer available."

    # no slot doc exists for this hour yet / try to create one with our group already counted
    try:
        mongo.db.slots.insert_one({
            "date": booking_datetime,
            "hour": time_slot,
            "booked_count": total_drivers,
            "is_blocked": False,
        })
        return True, None
    
    # someone else inserted a slot for this hour between our find and our insert, we try to do the update once more but otherwise just return error
    except DuplicateKeyError:                                                                   
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
        # any other db error, just say error, so we dont accidentally expose ourselfs
        return False, "Could not reserve this slot. Please try again."


# booking creation function, for admin created bookings payments are defaulted to paid while the public flow passes pending so the slot is held until Stripe confirms
def fn_create_booking(mongo, user_id_string, booking_data, payment_status="paid"):              
    booking_date = booking_data["date"]
    time_slot = booking_data["time_slot"]
    adult_count = booking_data["adult_count"]
    junior_count = booking_data["junior_count"]
    package_id = booking_data["package_id"]
    extra_rides = booking_data.get("extra_rides", 0)

    # calculate total price
    total_drivers = adult_count + junior_count
    total_amount = fn_calculate_total(adult_count, junior_count, package_id, extra_rides)
    if total_amount is None:
        return None, None, "Invalid package."

    settings = fn_get_or_create_settings(mongo)
    max_capacity = settings.get("max_capacity_per_slot", MAX_CAPACITY_DEFAULT)
    opening_hours = settings.get("opening_hours", DEFAULT_OPENING_HOURS)

    # check the requested hour falls within opening hours for that weekday so we protect against someone calling the api directly with a bad hour
    day_name = booking_date.strftime("%A").lower()                                              
    day_hours = opening_hours.get(day_name)
    if day_hours is None or time_slot < day_hours["open"] or time_slot >= day_hours["close"]:
        return None, None, "This time slot is outside opening hours."

    # date -> midnight datetime
    booking_datetime = datetime.combine(booking_date, datetime.min.time())                      

    # double-check the day isn't blocked
    blocked_day = mongo.db.blocked_days.find_one({"date": booking_datetime})                    
    if blocked_day is not None:
        return None, None, "This date is not available for bookings."

    ok, slot_error = fn_attempt_slot_booking(mongo, booking_datetime, time_slot, total_drivers, max_capacity)
    # capacity was already taken, abort, no booking was created
    if not ok:
        return None, None, slot_error

    # convert session string id into mongo's ObjectId
    user_object_id = ObjectId(user_id_string)
    
    # unguessable 16-byte url-safe token for our share function e.g. "k3Hg2-jq..." used in /bookings/share/<token>
    share_token = secrets.token_urlsafe(16)

    booking_doc = {
        "creator_user_id": user_object_id,
        "linked_user_ids": [user_object_id],
        "date": booking_datetime,
        "time_slot": time_slot,
        "adult_count": adult_count,
        "junior_count": junior_count,
        "total_drivers": total_drivers, 
        "package_id": package_id,
        "extra_rides": extra_rides, 
        "total_amount": total_amount,
        "payment_status": payment_status,
        "stripe_payment_id": None,
        "stripe_session_id": None,
        "share_token": share_token,
        "created_at": datetime.utcnow(),
    }

    insert_result = mongo.db.bookings.insert_one(booking_doc)

    # returns these to the front end so it can show the confirmation + share link
    return str(insert_result.inserted_id), share_token, None


# looks up a booking by its share token used by the public /bookings/share/<token> page
def fn_find_booking_by_share_token(mongo, share_token):
    return mongo.db.bookings.find_one({"share_token": share_token})


# looks up a booking by its string id - returns None on a malformed id rather than raising
def fn_find_booking_by_id(mongo, booking_id_string):
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return None
    return mongo.db.bookings.find_one({"_id": booking_object_id})


# gives a slot's capacity back when a booking is cancelled or refunded
def fn_release_slot_capacity(mongo, booking_doc):
    total_drivers = booking_doc.get("total_drivers", 0)
    booking_date = booking_doc.get("date")
    time_slot = booking_doc.get("time_slot")
    if total_drivers > 0 and booking_date is not None and time_slot is not None:
        mongo.db.slots.update_one(
            {"date": booking_date, "hour": time_slot},
            {"$inc": {"booked_count": -total_drivers}},
        )


# records the Stripe Checkout Session on the booking right after we create it
def fn_set_checkout_session(mongo, booking_id_string, session_id, payment_intent_id):           
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return False
    result = mongo.db.bookings.update_one(
        {"_id": booking_object_id},
        {"$set": {"stripe_session_id": session_id, "stripe_payment_id": payment_intent_id}},
    )
    return result.matched_count > 0


# called by the webhook on checkout.session.completed, the source of truth for "paid"
def fn_mark_booking_paid(mongo, booking_id_string, payment_intent_id):
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return None
    result = mongo.db.bookings.update_one(
        {"_id": booking_object_id, "payment_status": "pending"},    # only flip pending to paid; ignore if already paid (duplicate webhook) or cancelled
        {"$set": {"payment_status": "paid", "stripe_payment_id": payment_intent_id, "paid_at": datetime.utcnow()}},
    )

    # nothing changed - either not found or wasn't pending
    if result.modified_count == 0:
        return None
    
    # return the updated doc so the caller can trigger a confirmation email
    return mongo.db.bookings.find_one({"_id": booking_object_id})                               


# deletes a still-pending booking and frees its slot - used by the cancel URL and expiry webhook
def fn_release_pending_booking(mongo, booking_id_string):
    try:
        booking_object_id = ObjectId(booking_id_string)
    except (InvalidId, TypeError):
        return False
    booking_doc = mongo.db.bookings.find_one({"_id": booking_object_id})

     # never touch a paid/cancelled/refunded booking
    if booking_doc is None or booking_doc.get("payment_status") != "pending":
        return False
    
    # filter on pending so we don't race a webhook that's marking it paid
    delete_result = mongo.db.bookings.delete_one({"_id": booking_object_id, "payment_status": "pending"})
    if delete_result.deleted_count > 0:
        fn_release_slot_capacity(mongo, booking_doc)
        return True
    
    # nothing deleted - it must have just become paid
    return False                                                                                


# deletes bookings stuck in pending so abandoned checkouts don't hog slot capacity
def fn_cleanup_abandoned_bookings(mongo, max_age_minutes=30):
    cutoff = datetime.utcnow() - timedelta(minutes=max_age_minutes)
    abandoned = list(mongo.db.bookings.find({"payment_status": "pending", "created_at": {"$lt": cutoff}}))
    cleaned = 0
    for booking_doc in abandoned:
        # re-check status to avoid racing a webhook marking it paid right now
        delete_result = mongo.db.bookings.delete_one({"_id": booking_doc["_id"], "payment_status": "pending"})
        if delete_result.deleted_count > 0:
            fn_release_slot_capacity(mongo, booking_doc)
            cleaned += 1
    return cleaned


# returns every booking the user is linked to (created or shared with), regardless of date or status - caller splits into upcoming vs past
def fn_get_user_bookings(mongo, user_id_string):                                                
    try:
        user_object_id = ObjectId(user_id_string)
    
    # error handling
    except Exception:                                                                           
        return []
    return list(
        # match if user appears in linked_user_ids (covers both "I created this" and "someone shared this with me")
        mongo.db.bookings.find({
            "linked_user_ids": user_object_id,
        }).sort("date", 1) # soonest first - the route re-orders the past list to most-recent-first
    )


# adds the current user to a booking's linked_user_ids, called when someone clicks "Add to my account" on a share page
def fn_add_linked_user(mongo, share_token, user_id_string):
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return False
    result = mongo.db.bookings.update_one(
        {"share_token": share_token},
        {"$addToSet": {"linked_user_ids": user_object_id}},
    )

    # True if a booking with that share_token existed
    return result.matched_count > 0


# converts a mongo booking doc into a json-safe dict to send to the front end
def fn_format_booking_for_api(booking, current_user_id_string):
    creator_id = str(booking.get("creator_user_id", ""))
    is_creator = creator_id == current_user_id_string
    booking_date = booking.get("date")

    # iso-style date string is easiest to parse in javascript
    date_str = booking_date.strftime("%Y-%m-%d") if booking_date else ""
    today_midnight = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    # the booking date has already passed - drives the "Completed" badge and the past-bookings section
    is_past = bool(booking_date is not None and booking_date < today_midnight)      

    time_slot = booking.get("time_slot", 0)
    created_at = booking.get("created_at")
    return {
        "id": str(booking["_id"]),
        "ref": str(booking["_id"])[-6:].upper(),
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
        "is_past": is_past,
        "created_at": created_at.isoformat() if created_at else "",
    }