import re
from datetime import date, datetime
from email_validator import validate_email, EmailNotValidError

AU_PHONE_RE = re.compile(r"^(\+614|04)\d{8}$")                  # australian number only - i guess is limiting for people that are tourists... out of the scope for this project

ALLOWED_GENDERS = {"male", "female", "other", "prefer_not_to_say"}


def is_valid_email(email):                                      # email validity checker from library  
    try:
        validate_email(email, check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


def is_valid_au_phone(phone):                                   # phone checker using regex to allow for +61 and 04... formats
    if not isinstance(phone, str):
        return False
    cleaned = phone.replace(" ", "").replace("-", "")
    return bool(AU_PHONE_RE.match(cleaned))


def is_valid_password(password):                                # password validity checker - so we have users with strong passwords
    if not isinstance(password, str) or len(password) < 8:
        return False
    has_letter = any(c.isalpha() for c in password)
    has_number = any(c.isdigit() for c in password)
    return has_letter and has_number


def parse_dob(dob_str):                                         # ensures date of birth is in correct format
    try:
        return datetime.strptime(dob_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def age_from_dob(dob):                                          # age calculator
    today = date.today()
    years = today.year - dob.year
    if (today.month, today.day) < (dob.month, dob.day):
        years -= 1
    return years


def is_adult(dob):                                              # only 18+ can register
    return age_from_dob(dob) >= 18


def validate_registration(data):                                # ensure everything is entered
    required = ["first_name", "last_name", "gender", "dob",
                "address", "phone", "email", "password"]
    for field in required:
        if not data.get(field):
            return None, f"Please fill in all fields ({field.replace('_', ' ')} is missing)."

    first_name = data["first_name"].strip()
    last_name = data["last_name"].strip()
    gender = data["gender"].strip().lower()
    address = data["address"].strip()
    phone = data["phone"].strip()
    email = data["email"].strip().lower()
    password = data["password"]                                

    if gender not in ALLOWED_GENDERS:
        return None, "Please select a valid gender option."

    if not is_valid_email(email):
        return None, "Please enter a valid email address."

    if not is_valid_au_phone(phone):
        return None, "Please enter a valid Australian phone number (e.g. 0412 345 678)."

    dob = parse_dob(data["dob"])
    if dob is None:
        return None, "Please enter a valid date of birth."

    if not is_adult(dob):
        return None, "You must be 18 or over to register. Minors need to register under an adult's account."

    if not is_valid_password(password):
        return None, "Password must be at least 8 characters and contain a letter and a number."

    cleaned = {
        "first_name": first_name,
        "last_name": last_name,
        "gender": gender,
        "dob": datetime.combine(dob, datetime.min.time()),
        "address": address,
        "phone": phone,
        "email": email,
        "password": password,                                  
    }
    return cleaned, None
