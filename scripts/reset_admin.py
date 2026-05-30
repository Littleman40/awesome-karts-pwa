# one-off: wipe the existing admin account and recreate it from ADMIN_EMAIL / ADMIN_PASSWORD in env
import os
import sys

# ensure the project root is on sys.path so 'from config import ...' works when running as a script
ROOT_DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIRECTORY not in sys.path:
    sys.path.insert(0, ROOT_DIRECTORY)

from flask import Flask
from config import Config
from extensions import mongo
from models.admin import fn_get_admin_collection, fn_create_admin


def fn_main():

    # both come from .env via dotenv (already loaded by config.py)
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")

    if not admin_email:
        print("ERROR: ADMIN_EMAIL is not set in your .env file.")
        sys.exit(1)
    if not admin_password:
        print("ERROR: ADMIN_PASSWORD is not set in your .env file.")
        sys.exit(1)

    app = Flask(__name__)
    app.config.from_object(Config)
    mongo.init_app(app)

    with app.app_context():
        # delete every existing admin so fn_create_admin will accept the new one
        delete_result = fn_get_admin_collection(mongo).delete_many({})
        print(f"Removed {delete_result.deleted_count} existing admin account(s).")

        new_admin_id, error_message = fn_create_admin(mongo, admin_email, admin_password)
        if error_message is not None:
            print(f"ERROR: {error_message}")
            sys.exit(1)

        print(f"Admin account recreated successfully for {admin_email}.")
        print(f"Admin id: {new_admin_id}")


if __name__ == "__main__":
    fn_main()
