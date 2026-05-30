# input validation helpers used by routes/auth.py at registration time
import re
from datetime import date, datetime
from email_validator import validate_email, EmailNotValidError

# australian mobile only - tourists are out of scope for this project
AU_PHONE_RE = re.compile(r"^(\+614|04)\d{8}$")

ALLOWED_GENDERS = {"male", "female", "other", "prefer_not_to_say"}


# email validity checker using the email-validator library
def fn_is_valid_email(email_address):
    try:
        validate_email(email_address, check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


# phone checker - accepts +614... and 04... formats, strips spaces and dashes first
def fn_is_valid_au_phone(phone_number):
    if not isinstance(phone_number, str):
        return False
    cleaned_phone = phone_number.replace(" ", "").replace("-", "")
    return bool(AU_PHONE_RE.match(cleaned_phone))


# password validity checker, requires at least 8 chars with a letter and a number
def fn_is_valid_password(plain_text_password):
    if not isinstance(plain_text_password, str) or len(plain_text_password) < 8:
        return False
    has_letter_character = any(c.isalpha() for c in plain_text_password)
    has_number_character = any(c.isdigit() for c in plain_text_password)
    return has_letter_character and has_number_character


# parses a YYYY-MM-DD string into a date object, returns None on failure
def fn_parse_date_of_birth(date_of_birth_string):
    try:
        return datetime.strptime(date_of_birth_string, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


# calculates how old someone is today from their date of birth
def fn_get_age_from_dob(date_of_birth):
    current_date = date.today()
    user_age = current_date.year - date_of_birth.year
    if (current_date.month, current_date.day) < (date_of_birth.month, date_of_birth.day):
        user_age -= 1
    return user_age


# only adults (18+) can register - minors go under a parent's account
def fn_is_adult(date_of_birth):
    return fn_get_age_from_dob(date_of_birth) >= 18


# validates all registration fields - returns (cleaned_data, None) on success or (None, error_message) on failure
def fn_validate_registration(registration_data):
    required_fields = ["first_name", "last_name", "gender", "dob", "address", "phone", "email", "password"]
    for field in required_fields:
        if not registration_data.get(field):
            return None, f"Please fill in all fields ({field.replace('_', ' ')} is missing)."

    first_name = registration_data["first_name"].strip()
    last_name = registration_data["last_name"].strip()
    gender = registration_data["gender"].strip().lower()
    address = registration_data["address"].strip()
    phone = registration_data["phone"].strip()
    email_address = registration_data["email"].strip().lower()
    plain_text_password = registration_data["password"]

    if gender not in ALLOWED_GENDERS:
        return None, "Please select a valid gender option."

    if not fn_is_valid_email(email_address):
        return None, "Please enter a valid email address."

    if not fn_is_valid_au_phone(phone):
        return None, "Please enter a valid Australian phone number (e.g. 0412 345 678)."

    date_of_birth = fn_parse_date_of_birth(registration_data["dob"])
    if date_of_birth is None:
        return None, "Please enter a valid date of birth."

    if not fn_is_adult(date_of_birth):
        return None, "You must be 18 or over to register. Minors need to register under an adult's account."

    if not fn_is_valid_password(plain_text_password):
        return None, "Password must be at least 8 characters and contain a letter and a number."

    cleaned_registration_data = {
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,

        # store dob as a midnight datetime to match how we store all datetimes
        "dob": datetime.combine(date_of_birth, datetime.min.time()),
        "address": address,
        "phone": phone,
        "email": email_address,
        "password": plain_text_password,
    }
    return cleaned_registration_data, None
