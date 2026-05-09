from datetime import datetime          
import bcrypt                          
from bson import ObjectId              


def _users(mongo):                                                              # for internal use only - would return all the users connected to db
    return mongo.db.users


def ensure_indexes(mongo):                                                      # ensures every user has unique email address 
    _users(mongo).create_index("email", unique=True)


def hash_password(plain):                                                       # hashing for password - uses gensalt to recreate random hash for each user - just normal hashing stuff lol
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain, hashed):                                             # compares plain password to hashed stored password
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, AttributeError):                                        # error handling to avoid crashes
        return False


def find_by_email(mongo, email):                                                # find users by email - used to check for duplicates
    return _users(mongo).find_one({"email": email.lower()})


def find_by_id(mongo, user_id):                                                 # converts user id string to object id
    try:
        oid = ObjectId(user_id)
    except Exception:
        return None
    return _users(mongo).find_one({"_id": oid})


def email_exists(mongo, email):                                                 # checks if an email is already registered
    return _users(mongo).count_documents({"email": email.lower()}, limit=1) > 0


def create_user(mongo, cleaned):                                                # creates new user in mongodb - cleaned comes from the validators.py
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
    result = _users(mongo).insert_one(doc)                                     # inserts into the db
    return str(result.inserted_id)                                             # returns the userid used for session cookies
