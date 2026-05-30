# functions for our accounts
from datetime import datetime
import bcrypt
from bson import ObjectId


# for internal use only - would return all the users connected to db
def fn_get_users_collection(mongo):
    return mongo.db.users


# ensures every user has unique email address 
def fn_ensure_db_indexes(mongo):
    fn_get_users_collection(mongo).create_index("email", unique=True)


# hashing for password - uses gensalt to recreate random hash for each user - just normal hashing stuff lol
def fn_hash_password(plain_text_password):
    return bcrypt.hashpw(plain_text_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# compares plain password to hashed stored password
def fn_verify_password(plain_text_password, hashed_password):
    try:
        return bcrypt.checkpw(plain_text_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except (ValueError, AttributeError):
        return False


# find users by email - used to check for duplicates
def fn_find_user_by_email(mongo, email_address):
    return fn_get_users_collection(mongo).find_one({"email": email_address.lower()})


# converts user id string to object id
def fn_find_user_by_id(mongo, user_id_string):
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return None
    return fn_get_users_collection(mongo).find_one({"_id": user_object_id})


# checks if an email is already registered
def fn_check_email_exists(mongo, email_address):
    return fn_get_users_collection(mongo).count_documents({"email": email_address.lower()}, limit=1) > 0


# creates new user in mongodb - cleaned comes from the validators.py
def fn_create_user(mongo, cleaned_user_data):
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

    # inserts into the db
    insert_result = fn_get_users_collection(mongo).insert_one(new_user_document)

    # returns the userid used for session cookies
    return str(insert_result.inserted_id)


# full account deletion: cancels bookings (no refund), frees slot capacity, removes minors, deletes user
def fn_delete_user_account(mongo, user_id_string):
    try:
        user_object_id = ObjectId(user_id_string)
    except Exception:
        return False

    bookings_collection = mongo.db.bookings
    slots_collection = mongo.db.slots

    # find every booking this user created so we can cancel them and free slot capacity
    created_bookings = list(bookings_collection.find({                                  
        "creator_user_id": user_object_id,
        "payment_status": {"$nin": ["cancelled", "refunded"]},
    }))

     # give the slot capacity back so the time becomes bookable again
    for booking in created_bookings:
        total_drivers = booking.get("total_drivers", 0)
        booking_date = booking.get("date")
        time_slot = booking.get("time_slot")
        if total_drivers > 0 and booking_date is not None and time_slot is not None:
            slots_collection.update_one(                                               
                {"date": booking_date, "hour": time_slot},
                {"$inc": {"booked_count": -total_drivers}},
            )


    # mark all of this user's created bookings as cancelled
    if created_bookings:
        bookings_collection.update_many(                                                
            {"_id": {"$in": [b["_id"] for b in created_bookings]}},
            {"$set": {"payment_status": "cancelled"}},
        )

    # remove the user from any shared bookings they were linked to but didn't create
    bookings_collection.update_many(                                                    
        {"linked_user_ids": user_object_id, "creator_user_id": {"$ne": user_object_id}},
        {"$pull": {"linked_user_ids": user_object_id}},
    )

    # waivers live on the minor docs themselves so deleting the minor removes the waiver too
    mongo.db.minors.delete_many({"user_id": user_object_id})                            
    delete_result = fn_get_users_collection(mongo).delete_one({"_id": user_object_id})
    return delete_result.deleted_count > 0
