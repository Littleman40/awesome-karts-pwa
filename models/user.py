from datetime import datetime
import bcrypt
from bson import ObjectId


def _users(mongo):
    return mongo.db.users


def ensure_indexes(mongo):
    _users(mongo).create_index("email", unique=True)


def hash_password(plain):
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain, hashed):
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, AttributeError):
        return False


def find_by_email(mongo, email):
    return _users(mongo).find_one({"email": email.lower()})


def find_by_id(mongo, user_id):
    try:
        oid = ObjectId(user_id)
    except Exception:
        return None
    return _users(mongo).find_one({"_id": oid})


def email_exists(mongo, email):
    return _users(mongo).count_documents({"email": email.lower()}, limit=1) > 0


def create_user(mongo, cleaned):
    """cleaned comes from validators.validate_registration."""
    doc = {
        "first_name": cleaned["first_name"],
        "last_name": cleaned["last_name"],
        "gender": cleaned["gender"],
        "dob": cleaned["dob"],
        "address": cleaned["address"],
        "phone": cleaned["phone"],
        "email": cleaned["email"],
        "password_hash": hash_password(cleaned["password"]),
        "created_at": datetime.utcnow(),
        "waiver_accepted": False,
        "waiver_accepted_at": None,
    }
    result = _users(mongo).insert_one(doc)
    return str(result.inserted_id)
