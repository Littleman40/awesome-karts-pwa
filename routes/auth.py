from flask import Blueprint, request, jsonify, session
from pymongo.errors import DuplicateKeyError      

from extensions import mongo                       # imports from other files in project
from models import user as user_model              # imports from other files in project
from utils.validators import validate_registration # imports from other files in project


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")                       # makes code cleaner by grouping auth together


def _ok(data=None, status=200):                                                     # success response
    return jsonify({"success": True, "data": data or {}}), status


def _err(message, status=400):                                                      # error response
    return jsonify({"success": False, "error": message}), status


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}                                      # reads json body and returns none to avoid crashes if malformed

    cleaned, error = validate_registration(data)                                    # server sided validation
    if error:
        return _err(error, 400)                                                     # returns error is error exists

    if user_model.email_exists(mongo, cleaned["email"]):                            # duplicate email check
        return _err("An account with this email already exists.", 400)

    try:
        user_id = user_model.create_user(mongo, cleaned)                            # create the user
    except DuplicateKeyError:
        return _err("An account with this email already exists.", 400)              # more error handling just in case

    session.permanent = True                                                        # log in the user so they dont need to log in after registering 
    session["user_id"] = user_id                  

    return _ok({"redirect": "/dashboard"}, 201)                                     # return successful response and redirect to dashboard


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}                                      # reads json body and returns none to avoid crashes if malformed

    email = (data.get("email") or "").strip().lower() 
    password = data.get("password") or ""

    if not email or not password:           
        return _err("Invalid email or password.", 400)                              # generic message to avoid giving hints about which field is wrong - done for everything below too

    user = user_model.find_by_email(mongo, email)         
    if not user:                                                                    # checks if user exists
        return _err("Invalid email or password.", 400)

    if not user_model.verify_password(password, user.get("password_hash", "")):     # checks password hash
        return _err("Invalid email or password.", 400)

    session.permanent = True                                                        # log in with session cookie         
    session["user_id"] = str(user["_id"])       

    return _ok({"redirect": "/dashboard"})                                          # success and redirect to dashboard


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()                                                                 # clears session cookie to log out user
    return _ok({"redirect": "/"})
