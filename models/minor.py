# our functions for the minor account creation in the user dashboard
from datetime import datetime, date as date_type
from bson import ObjectId

ALLOWED_GENDERS = {
    "male", 
    "female", 
    "other", 
    "prefer_not_to_say"
}


# tiny helper so we don't hard-code mongo.db.minors everywhere
def fn_get_minors_collection(mongo):
    return mongo.db.minors


# works out a persons age in years from their date of birth
def fn_get_age(dob):
    today = date_type.today()
    age = today.year - dob.year

    # if their birthday hasn't happened yet this year, subtract one
    if (today.month, today.day) < (dob.month, dob.day):
        age -= 1

    return age


# returns all minors linked to a given user
def fn_get_user_minors(mongo, user_id_string):
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return []
    return list(fn_get_minors_collection(mongo).find({"user_id": user_object_id}))


# validates a "register a minor" payload then inserts the minor doc
def fn_add_minor(mongo, user_id_string, minor_data):
    first_name = minor_data.get("first_name", "").strip()
    last_name = minor_data.get("last_name", "").strip()
    
    # lower-case so it matches the ALLOWED_GENDERS set
    gender = minor_data.get("gender", "").strip().lower()
    dob_string = minor_data.get("dob", "")

    # reject any empty field
    if not first_name or not last_name or not gender or not dob_string:
        return None, "Please fill in all fields."

    # reject anything outside the whitelist
    if gender not in ALLOWED_GENDERS:
        return None, "Please select a valid gender."

    # the html date input gives us yyyy-mm-dd
    try:
        dob = datetime.strptime(dob_string, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None, "Please enter a valid date of birth."

    # people must be 8+ to drive a junior kart
    age = fn_get_age(dob)
    if age < 8:
        return None, "Minors must be at least 8 years old to drive."
    
    # if theyre 18+ they need their own user account, minors collection is for under 18s only
    if age >= 18:
        return None, "This person is 18 or over and can register their own account."

    # parent's id links the minor doc to its parent
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return None, "Invalid user."

    minor_doc = {
        "user_id": user_object_id,
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,
        "dob": datetime.combine(dob, datetime.min.time()),
        "waiver_accepted": False,
        "waiver_accepted_at": None,
    }

    result = fn_get_minors_collection(mongo).insert_one(minor_doc)
    
    # sends id back to front end so the dashboard can refresh
    return str(result.inserted_id), None


# deletes a minor doc and only if it belongs to the requesting user
def fn_remove_minor(mongo, user_id_string, minor_id_string):                    
    try:
        user_object_id = ObjectId(user_id_string)
        minor_object_id = ObjectId(minor_id_string)
    except Exception:
        return False
    result = fn_get_minors_collection(mongo).delete_one({
        "_id": minor_object_id,
        "user_id": user_object_id,
    })

    # True if a doc was actually deleted
    return result.deleted_count > 0


# marks a minor's waiver as signed by their parent/guardian
def fn_sign_minor_waiver(mongo, user_id_string, minor_id_string):
    try:
        user_object_id = ObjectId(user_id_string)
        minor_object_id = ObjectId(minor_id_string)
    except Exception:
        return False
    
    # same ownership check as remove - protects against signing other people's minors' waivers
    result = fn_get_minors_collection(mongo).update_one(
        {"_id": minor_object_id, "user_id": user_object_id},
        {"$set": {"waiver_accepted": True, "waiver_accepted_at": datetime.utcnow()}},
    )
    return result.modified_count > 0


# converts a mongo minor doc to a json-safe dict for sending to the dashboard
def fn_format_minor_for_api(minor):
    dob = minor.get("dob")
    age = None
    if dob is not None:
        dob_as_date = dob.date() if isinstance(dob, datetime) else dob
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
