from flask import Blueprint, request, jsonify, session
from pymongo.errors import DuplicateKeyError

from extensions import mongo
from models import user as user_model
from utils.validators import validate_registration


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _ok(data=None, status=200):
    return jsonify({"success": True, "data": data or {}}), status


def _err(message, status=400):
    return jsonify({"success": False, "error": message}), status


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    cleaned, error = validate_registration(data)
    if error:
        return _err(error, 400)


    if user_model.email_exists(mongo, cleaned["email"]):
        return _err("An account with this email already exists.", 400)

    try:
        user_id = user_model.create_user(mongo, cleaned)
    except DuplicateKeyError:
        return _err("An account with this email already exists.", 400)

    session.permanent = True
    session["user_id"] = user_id

    return _ok({"redirect": "/dashboard"}, 201)


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return _err("Invalid email or password.", 400)

    user = user_model.find_by_email(mongo, email)
    if not user:
        return _err("Invalid email or password.", 400)

    if not user_model.verify_password(password, user.get("password_hash", "")):
        return _err("Invalid email or password.", 400)

    session.permanent = True
    session["user_id"] = str(user["_id"])

    return _ok({"redirect": "/dashboard"})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return _ok({"redirect": "/"})
