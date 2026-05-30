# our admin functions, mainly for the admin panel and when we first create the admin account
import bcrypt
from bson import ObjectId

# tiny helper so we don't hard-code mongo.db.admin everywhere
def fn_get_admin_collection(mongo):
    return mongo.db.admin

# password hashing for admin, exact same as we do for regular users
def fn_hash_password(plain_text_password):
    return bcrypt.hashpw(plain_text_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

# verifies the passwords, so it compares the bycrpt hashes
def fn_verify_password(plain_text_password, hashed_password):               
    try:
        return bcrypt.checkpw(plain_text_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, AttributeError):
        return False

# used by the setup script to refuse creating a second admin
def fn_admin_exists(mongo):       
    return fn_get_admin_collection(mongo).count_documents({}, limit=1) > 0

# used to find the admin account on /api/admin/auth/login
def fn_find_admin_by_email(mongo, email_address):                          
    if not isinstance(email_address, str):
        return None
    return fn_get_admin_collection(mongo).find_one({"email": email_address.strip().lower()})

# used by the context processor to look up the logged-in admin each request
def fn_find_admin_by_id(mongo, admin_id_string):
    try:
        admin_object_id = ObjectId(admin_id_string)
    except Exception:
        return None
    return fn_get_admin_collection(mongo).find_one({"_id": admin_object_id})

# called only by scripts/create_admin.py - refuses if one already exists
def fn_create_admin(mongo, email_address, plain_text_password):
    if fn_admin_exists(mongo):
        return None, "An admin account already exists. We do not allow for 2 admin accounts."

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