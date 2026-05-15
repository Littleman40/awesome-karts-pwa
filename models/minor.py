from datetime import datetime, date as date_type
from bson import ObjectId

ALLOWED_GENDERS = {"male", "female", "other", "prefer_not_to_say"}


def fn_get_minors_collection(mongo):                                            # tiny helper so we don't hard-code mongo.db.minors everywhere
    return mongo.db.minors


def fn_get_age(dob):                                                            # works out a persons age in years from their date of birth
    today = date_type.today()
    age = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):                         # if their birthday hasn't happened yet this year, subtract one
        age -= 1
    return age


def fn_get_user_minors(mongo, user_id_string):                                  # returns all minors linked to a given user
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:                                                           # error handling
        return []
    return list(fn_get_minors_collection(mongo).find({"user_id": user_object_id}))


def fn_add_minor(mongo, user_id_string, minor_data):                            # validates a "register a minor" payload then inserts the minor doc
    first_name = minor_data.get("first_name", "").strip()
    last_name = minor_data.get("last_name", "").strip()
    gender = minor_data.get("gender", "").strip().lower()                       # lower-case so it matches the ALLOWED_GENDERS set
    dob_string = minor_data.get("dob", "")

    if not first_name or not last_name or not gender or not dob_string:         # reject any empty field
        return None, "Please fill in all fields."

    if gender not in ALLOWED_GENDERS:                                           # reject anything outside the whitelist
        return None, "Please select a valid gender."

    try:
        dob = datetime.strptime(dob_string, "%Y-%m-%d").date()                  # the html date input gives us yyyy-mm-dd
    except (ValueError, TypeError):                                             # reject bad date string
        return None, "Please enter a valid date of birth."

    age = fn_get_age(dob)
    if age < 8:                                                                 # business rule: must be 8+ to drive a junior kart
        return None, "Minors must be at least 8 years old to drive."
    if age >= 18:                                                               # if theyre 18+ they need their own user account, minors collection is for under 18s only
        return None, "This person is 18 or over and can register their own account."

    try:
        user_object_id = ObjectId(user_id_string)                               # parent's id links the minor doc to its parent
    except Exception:
        return None, "Invalid user."

    minor_doc = {
        "user_id": user_object_id,                                              # foreign key back to users collection (the parent/guardian)
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,
        "dob": datetime.combine(dob, datetime.min.time()),                      # store as datetime at midnight
        "waiver_accepted": False,                                               # starts unsigned
        "waiver_accepted_at": None,
    }

    result = fn_get_minors_collection(mongo).insert_one(minor_doc)
    return str(result.inserted_id), None                                        # sends id back to front end so the dashboard can refresh


def fn_remove_minor(mongo, user_id_string, minor_id_string):                    # deletes a minor doc and only if it belongs to the requesting user
    try:
        user_object_id = ObjectId(user_id_string)
        minor_object_id = ObjectId(minor_id_string)
    except Exception:
        return False
    result = fn_get_minors_collection(mongo).delete_one({
        "_id": minor_object_id,
        "user_id": user_object_id,                                              # only match if the minor's user_id == requesting user
    })
    return result.deleted_count > 0                                             # True if a doc was actually deleted


def fn_sign_minor_waiver(mongo, user_id_string, minor_id_string):               # marks a minor's waiver as signed by their parent/guardian
    try:
        user_object_id = ObjectId(user_id_string)
        minor_object_id = ObjectId(minor_id_string)
    except Exception:
        return False
    result = fn_get_minors_collection(mongo).update_one(
        {"_id": minor_object_id, "user_id": user_object_id},                    # same ownership check as remove — protects against signing other people's minors' waivers
        {"$set": {"waiver_accepted": True, "waiver_accepted_at": datetime.utcnow()}},
    )
    return result.modified_count > 0


def fn_format_minor_for_api(minor):                                             # converts a mongo minor doc to a json-safe dict for sending to the dashboard
    dob = minor.get("dob")
    age = None
    if dob is not None:
        dob_as_date = dob.date() if isinstance(dob, datetime) else dob          # mongo gives us a datetime, but fn_get_age expects a date and convert if needed
        age = fn_get_age(dob_as_date)
    waiver_at = minor.get("waiver_accepted_at")
    return {
        "id": str(minor["_id"]),
        "first_name": minor.get("first_name", ""),
        "last_name": minor.get("last_name", ""),
        "gender": minor.get("gender", ""),
        "dob": dob.strftime("%Y-%m-%d") if dob else None,
        "age": age,
        "waiver_accepted": minor.get("waiver_accepted", False),
        "waiver_accepted_at": waiver_at.isoformat() if waiver_at else None,
    }
