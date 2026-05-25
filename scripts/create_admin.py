import os
import sys

ROOT_DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))    # ensure the project root is on sys.path so 'from config import ...' works when running as a script
if ROOT_DIRECTORY not in sys.path:
    sys.path.insert(0, ROOT_DIRECTORY)

from flask import Flask                                                         # built locally just to give us an app_context for Flask-PyMongo
from config import Config
from extensions import mongo
from models.admin import fn_admin_exists, fn_create_admin


def fn_main():
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()             # both come from .env via dotenv (already loaded by config.py)
    admin_password = os.environ.get("ADMIN_PASSWORD", "")

    if not admin_email:
        print("ERROR: ADMIN_EMAIL is not set in your .env file.")
        sys.exit(1)
    if not admin_password:
        print("ERROR: ADMIN_PASSWORD is not set in your .env file.")
        sys.exit(1)

    app = Flask(__name__)                                                       # minimal app so Flask-PyMongo can attach to it
    app.config.from_object(Config)
    mongo.init_app(app)

    with app.app_context():
        if fn_admin_exists(mongo):
            print("An admin account already exists. No action taken.")
            sys.exit(0)

        new_admin_id, error_message = fn_create_admin(mongo, admin_email, admin_password)
        if error_message is not None:
            print(f"ERROR: {error_message}")
            sys.exit(1)

        print(f"Admin account created successfully for {admin_email}.")
        print(f"Admin id: {new_admin_id}")


if __name__ == "__main__":
    fn_main()
