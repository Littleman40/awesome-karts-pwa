import bcrypt
from bson import ObjectId


def fn_get_admin_collection(mongo):                                         # tiny helper so we don't hard-code mongo.db.admin everywhere
    return mongo.db.admin


def fn_hash_password(plain_text_password):                                  # bcrypt with random salt, same scheme as the regular users collection
    return bcrypt.hashpw(plain_text_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def fn_verify_password(plain_text_password, hashed_password):               # compares plain to bcrypt hash, returns False on any error so a bad row can't crash login
    try:
        return bcrypt.checkpw(plain_text_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, AttributeError):
        return False


def fn_admin_exists(mongo):                                                 # used by the setup script to refuse creating a second admin
    return fn_get_admin_collection(mongo).count_documents({}, limit=1) > 0


def fn_find_admin_by_email(mongo, email_address):                           # used by /api/admin/auth/login
    if not isinstance(email_address, str):
        return None
    return fn_get_admin_collection(mongo).find_one({"email": email_address.strip().lower()})


def fn_find_admin_by_id(mongo, admin_id_string):                            # used by the context processor to look up the logged-in admin each request
    try:
        admin_object_id = ObjectId(admin_id_string)
    except Exception:
        return None
    return fn_get_admin_collection(mongo).find_one({"_id": admin_object_id})


def fn_create_admin(mongo, email_address, plain_text_password):             # called only by scripts/create_admin.py - refuses if one already exists
    if fn_admin_exists(mongo):
        return None, "An admin account already exists. Refusing to create a second one."

    cleaned_email = (email_address or "").strip().lower()
    if not cleaned_email or "@" not in cleaned_email:
        return None, "Please provide a valid admin email address."

    if not plain_text_password or len(plain_text_password) < 8:
        return None, "Admin password must be at least 8 characters."

    new_admin_doc = {
        "email": cleaned_email,
        "password_hash": fn_hash_password(plain_text_password),
    }
    insert_result = fn_get_admin_collection(mongo).insert_one(new_admin_doc)
    return str(insert_result.inserted_id), None
