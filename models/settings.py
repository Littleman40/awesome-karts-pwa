# business settings model - stores and validates the single settings document in MongoDB
from datetime import datetime, date as date_type


# mirrors the default in models/booking.py so the public site still works before admin saves any settings
DEFAULT_OPENING_HOURS = {
    "monday":    {"open": 10, "close": 20},
    "tuesday":   {"open": 10, "close": 20},
    "wednesday": {"open": 10, "close": 20},
    "thursday":  {"open": 10, "close": 20},
    "friday":    {"open": 10, "close": 22},
    "saturday":  {"open":  9, "close": 22},
    "sunday":    {"open":  9, "close": 20},
}

DEFAULT_PRICING_CENTS = {
    "1_ride":     3750,
    "2_rides":    6500,
    "3_rides":    8500,

    "extra_ride": 2000,
}

# capacity cap per hour
DEFAULT_MAX_CAPACITY_PER_SLOT = 50

# fallback contact info shown on the public site if admin hasn't customised
DEFAULT_CONTACT = {
    "phone":   "0491 120 000",
    "email":   "hello@awesomekarts.com.au",
    "address": "123 Raceway Drive, Newcastle",
}

VALID_DAY_KEYS     = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
VALID_PRICING_KEYS = {"1_ride", "2_rides", "3_rides", "extra_ride"}


# tiny helper so we don't hard-code mongo.db.business_settings everywhere
def fn_get_settings_collection(mongo):
    return mongo.db.business_settings


# builds a complete default settings doc
def fn_build_default_settings():
    return {
        "opening_hours":       dict(DEFAULT_OPENING_HOURS),
        "public_holidays":     [],
        "school_holidays":     [],
        "pricing":             dict(DEFAULT_PRICING_CENTS),
        "max_capacity_per_slot": DEFAULT_MAX_CAPACITY_PER_SLOT,
        "phone":   DEFAULT_CONTACT["phone"],
        "email":   DEFAULT_CONTACT["email"],
        "address": DEFAULT_CONTACT["address"],
    }


# returns the single settings doc, creating it with defaults if missing
def fn_get_or_create_settings(mongo):
    collection = fn_get_settings_collection(mongo)
    settings   = collection.find_one({})
    if settings is not None:
        return settings
    default_doc = fn_build_default_settings()
    collection.insert_one(default_doc)

    # insert_one mutates default_doc with _id so it's safe to return directly
    return default_doc


# converts a mongo doc (with datetimes/ObjectId) into a json-safe dict for the admin frontend
def fn_format_settings_for_api(settings):
    def _date_to_string(value):
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d")
        if isinstance(value, date_type):
            return value.strftime("%Y-%m-%d")
        return value

    formatted = {
        "opening_hours": settings.get("opening_hours", DEFAULT_OPENING_HOURS),
        "public_holidays": [_date_to_string(d) for d in settings.get("public_holidays", [])],
        "school_holidays": [],
        "pricing": settings.get("pricing", DEFAULT_PRICING_CENTS),
        "max_capacity_per_slot": settings.get("max_capacity_per_slot", DEFAULT_MAX_CAPACITY_PER_SLOT),
        "phone": settings.get("phone", DEFAULT_CONTACT["phone"]),
        "email": settings.get("email", DEFAULT_CONTACT["email"]),
        "address": settings.get("address", DEFAULT_CONTACT["address"]),
    }
    for school_holiday_range in settings.get("school_holidays", []):
        formatted["school_holidays"].append({
            "start": _date_to_string(school_holiday_range.get("start")),
            "end": _date_to_string(school_holiday_range.get("end")),
        })
    return formatted


# validates fields the admin tried to update and returns (cleaned_update_dict, error_or_none)
def fn_validate_and_apply_update(existing_settings, incoming_update):
    cleaned_update = {}

    # validate opening hours one weekday at a time
    if "opening_hours" in incoming_update:
        opening_hours_input = incoming_update.get("opening_hours")
        if not isinstance(opening_hours_input, dict):
            return None, "Opening hours must be an object."
        cleaned_opening_hours = {}
        for day_key, day_hours in opening_hours_input.items():
            if day_key not in VALID_DAY_KEYS:
                return None, f"Unknown day '{day_key}' in opening hours."

            # admin can pass null to mark a day as closed
            if day_hours is None:
                cleaned_opening_hours[day_key] = None
                continue
            if not isinstance(day_hours, dict):
                return None, f"Hours for {day_key} must be an object or null."
            try:
                open_hour  = int(day_hours.get("open"))
                close_hour = int(day_hours.get("close"))
            except (TypeError, ValueError):
                return None, f"Hours for {day_key} must be integers."
            if not (0 <= open_hour <= 23) or not (0 <= close_hour <= 24):
                return None, f"Hours for {day_key} must be between 0 and 24."
            if open_hour >= close_hour:
                return None, f"For {day_key}, opening time must be before closing time."
            cleaned_opening_hours[day_key] = {"open": open_hour, "close": close_hour}
        cleaned_update["opening_hours"] = cleaned_opening_hours

    # validate pricing (cents, integers, non-negative)
    if "pricing" in incoming_update:
        pricing_input = incoming_update.get("pricing")
        if not isinstance(pricing_input, dict):
            return None, "Pricing must be an object."
        cleaned_pricing = dict(existing_settings.get("pricing", DEFAULT_PRICING_CENTS))
        for key, value in pricing_input.items():
            if key not in VALID_PRICING_KEYS:
                return None, f"Unknown pricing key '{key}'."
            try:
                cents = int(value)
            except (TypeError, ValueError):
                return None, f"Pricing for '{key}' must be an integer (cents)."
            if cents < 0:
                return None, f"Pricing for '{key}' cannot be negative."
            cleaned_pricing[key] = cents
        cleaned_update["pricing"] = cleaned_pricing

    # validate capacity
    if "max_capacity_per_slot" in incoming_update:
        try:
            capacity = int(incoming_update.get("max_capacity_per_slot"))
        except (TypeError, ValueError):
            return None, "Max capacity per slot must be an integer."
        if capacity < 1 or capacity > 500:
            return None, "Max capacity per slot must be between 1 and 500."
        cleaned_update["max_capacity_per_slot"] = capacity

    # plain string fields - just trim
    if "phone" in incoming_update:
        phone_value = incoming_update.get("phone")
        if not isinstance(phone_value, str):
            return None, "Phone must be a string."
        cleaned_update["phone"] = phone_value.strip()

    if "email" in incoming_update:
        email_value = incoming_update.get("email")
        if not isinstance(email_value, str) or "@" not in email_value:
            return None, "Please enter a valid email address."
        cleaned_update["email"] = email_value.strip()

    if "address" in incoming_update:
        address_value = incoming_update.get("address")
        if not isinstance(address_value, str):
            return None, "Address must be a string."
        cleaned_update["address"] = address_value.strip()

    # list of YYYY-MM-DD strings - store as midnight datetimes for consistency with bookings/slots
    if "public_holidays" in incoming_update:
        public_holidays_input = incoming_update.get("public_holidays")
        if not isinstance(public_holidays_input, list):
            return None, "Public holidays must be a list."
        cleaned_public_holidays = []
        for holiday_date_string in public_holidays_input:
            try:
                parsed = datetime.strptime(holiday_date_string, "%Y-%m-%d")
            except (TypeError, ValueError):
                return None, f"Invalid public holiday date '{holiday_date_string}'."
            cleaned_public_holidays.append(parsed)
        cleaned_update["public_holidays"] = cleaned_public_holidays

    # list of {start, end} ranges
    if "school_holidays" in incoming_update:
        school_holidays_input = incoming_update.get("school_holidays")
        if not isinstance(school_holidays_input, list):
            return None, "School holidays must be a list."
        cleaned_school_holidays = []
        for school_holiday_range in school_holidays_input:
            if not isinstance(school_holiday_range, dict):
                return None, "Each school holiday must be an object with start and end."
            try:
                start_dt = datetime.strptime(school_holiday_range.get("start", ""), "%Y-%m-%d")
                end_dt   = datetime.strptime(school_holiday_range.get("end",   ""), "%Y-%m-%d")
            except (TypeError, ValueError):
                return None, "School holiday dates must be YYYY-MM-DD."
            if end_dt < start_dt:
                return None, "School holiday end date cannot be before start date."
            cleaned_school_holidays.append({"start": start_dt, "end": end_dt})
        cleaned_update["school_holidays"] = cleaned_school_holidays

    return cleaned_update, None


# validates and persists a partial settings update
def fn_update_settings(mongo, incoming_update):
    existing_settings = fn_get_or_create_settings(mongo)
    cleaned_update, error = fn_validate_and_apply_update(existing_settings, incoming_update)
    if error is not None:
        return None, error

    # nothing valid was supplied - tell the caller so they can return a 400
    if not cleaned_update:
        return None, "No valid settings fields supplied."

    fn_get_settings_collection(mongo).update_one(
        {"_id": existing_settings["_id"]},
        {"$set": cleaned_update},
    )
    return fn_get_or_create_settings(mongo), None
