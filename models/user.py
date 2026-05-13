from datetime import datetime
import bcrypt
from bson import ObjectId


def fn_get_users_collection(mongo):                                     # for internal use only - would return all the users connected to db
    return mongo.db.users


def fn_ensure_db_indexes(mongo):                                        # ensures every user has unique email address 
    fn_get_users_collection(mongo).create_index("email", unique=True)


def fn_hash_password(plain_text_password):                              # hashing for password - uses gensalt to recreate random hash for each user - just normal hashing stuff lol
    return bcrypt.hashpw(plain_text_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def fn_verify_password(plain_text_password, hashed_password):           # compares plain password to hashed stored password
    try:
        return bcrypt.checkpw(plain_text_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, AttributeError):                                # error handling to avoid crashes
        return False


def fn_find_user_by_email(mongo, email_address):                        # find users by email - used to check for duplicates
    return fn_get_users_collection(mongo).find_one({"email": email_address.lower()})


def fn_find_user_by_id(mongo, user_id_string):                          # converts user id string to object id
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return None
    return fn_get_users_collection(mongo).find_one({"_id": user_object_id})


def fn_check_email_exists(mongo, email_address):                        # checks if an email is already registered
    return fn_get_users_collection(mongo).count_documents({"email": email_address.lower()}, limit=1) > 0


def fn_create_user(mongo, cleaned_user_data):                           # creates new user in mongodb - cleaned comes from the validators.py
    new_user_document = {
        "first_name": cleaned_user_data["first_name"],
        "last_name": cleaned_user_data["last_name"],
        "gender": cleaned_user_data["gender"],
        "dob": cleaned_user_data["dob"],
        "address": cleaned_user_data["address"],
        "phone": cleaned_user_data["phone"],
        "email": cleaned_user_data["email"],
        "password_hash": fn_hash_password(cleaned_user_data["password"]),
        "created_at": datetime.utcnow(),
        "waiver_accepted": False,
        "waiver_accepted_at": None,
    }
    insert_result = fn_get_users_collection(mongo).insert_one(new_user_document)        # inserts into the db
    return str(insert_result.inserted_id)                                               # returns the userid used for session cookies
