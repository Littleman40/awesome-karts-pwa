from flask import Flask, render_template, send_from_directory, session, redirect
from bson import ObjectId

from config import Config
from extensions import mongo
from models.user import fn_ensure_db_indexes, fn_find_user_by_id
from models.booking import fn_ensure_booking_indexes, fn_find_booking_by_share_token   # booking model / used for the share-link page and to create indexes on startup
from models.admin import fn_find_admin_by_id                                           # used by the context processor below so admin templates can show {{ current_admin.email }}
from routes.auth import auth_bp
from routes.bookings import bookings_bp                                                # /api/bookings/* / slot lookups, create, share-add
from routes.users import users_bp                                                      # /api/users/me/* / dashboard data (bookings, minors, waivers)
from routes.admin_auth import admin_auth_bp                                            # /api/admin/auth/* / admin login + logout (separate from user auth)
from routes.admin import admin_bp                                                      # /api/admin/* / everything the admin frontend talks to


def fn_create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    mongo.init_app(app)

    with app.app_context():
        try:
            fn_ensure_db_indexes(mongo)                             # unique index on users.email
            fn_ensure_booking_indexes(mongo)                        # unique compound index on slots.(date,hour) + unique share_token on bookings
        except Exception as index_error:
            app.logger.warning(f"Could not ensure MongoDB indexes: {index_error}")

    app.register_blueprint(auth_bp)                                 # /api/auth/* / login, register, logout
    app.register_blueprint(bookings_bp)                             # /api/bookings/* / slot lookups, create booking, add-to-account via share token
    app.register_blueprint(users_bp)                                # /api/users/me/* / dashboard data (bookings, minors, waivers)
    app.register_blueprint(admin_auth_bp)                           # /api/admin/auth/* / admin login + logout
    app.register_blueprint(admin_bp)                                # /api/admin/* / dashboard, bookings, customers, slots, waivers, settings

    @app.context_processor
    def fn_inject_current_user():
        current_user = None
        if "user_id" in session:                                    # if session cookie exists look up user in db
            current_user = fn_find_user_by_id(mongo, session["user_id"])
            if current_user is None:                                # if user doesnt exist then log them out
                session.clear()
        current_admin = None                                        # mirror the same pattern for admin sessions so admin templates can use {{ current_admin.email }}
        if "admin_id" in session:
            current_admin = fn_find_admin_by_id(mongo, session["admin_id"])
            if current_admin is None:                               # session points to a deleted admin - drop the cookie
                session.pop("admin_id", None)
        return {"current_user": current_user, "current_admin": current_admin}


    @app.route("/")
    def fn_home():
        return render_template("index.html")

    @app.route("/pricing")
    def fn_pricing():
        return render_template("pricing.html")

    @app.route("/track")
    def fn_track():
        return render_template("track.html")

    @app.route("/contact")
    def fn_contact():
        return render_template("contact.html")

    @app.route("/login")
    def fn_login():
        if "user_id" in session:
            return redirect("/dashboard")
        return render_template("login.html")

    @app.route("/register")
    def fn_register():
        if "user_id" in session:
            return redirect("/dashboard")
        return render_template("register.html")

    @app.route("/dashboard")
    def fn_dashboard():
        if "user_id" not in session:
            return redirect("/login")
        return render_template("dashboard.html")

    @app.route("/bookings")
    def fn_bookings():
        return render_template("bookings.html")

    @app.route("/bookings/share/<share_token>")                                                 # public share page / anyone with the link can see the booking details
    def fn_booking_share(share_token):
        booking = fn_find_booking_by_share_token(mongo, share_token)                            # booking can be None / template handles the "not found" state
        is_linked = False                                                                       # whether the currently-logged-in user is already on this booking
        if booking is not None and "user_id" in session:
            try:
                current_user_object_id = ObjectId(session["user_id"])
                if current_user_object_id in booking.get("linked_user_ids", []):                # already linked - dont show the Add button
                    is_linked = True
            except Exception:
                is_linked = False                                                               # if the session user_id is malformed just treat them as not linked
        return render_template(                                                                 # token also passed so the template can build the /login?next=... back-link
            "bookings_share.html",
            booking=booking,
            share_token=share_token,
            is_linked=is_linked,
        )

    @app.route("/admin/login")
    def fn_admin_login_page():                                                                  # admin login page - if already logged in as admin, send them straight to /admin
        if "admin_id" in session:
            return redirect("/admin")
        return render_template("admin/login.html")

    @app.route("/admin")
    def fn_admin_dashboard_page():                                                              # all the /admin/* page routes below redirect to /admin/login when not authed
        if "admin_id" not in session:
            return redirect("/admin/login")
        return render_template("admin/dashboard.html")

    @app.route("/admin/bookings")
    def fn_admin_bookings_page():
        if "admin_id" not in session:
            return redirect("/admin/login")
        return render_template("admin/bookings.html")

    @app.route("/admin/customers")
    def fn_admin_customers_page():
        if "admin_id" not in session:
            return redirect("/admin/login")
        return render_template("admin/customers.html")

    @app.route("/admin/settings")
    def fn_admin_settings_page():
        if "admin_id" not in session:
            return redirect("/admin/login")
        return render_template("admin/settings.html")

    @app.route("/refund-policy")
    def fn_refund_policy():
        return render_template("legal/refund-policy.html")

    @app.route("/privacy-policy")
    def fn_privacy_policy():
        return render_template("legal/privacy-policy.html")

    @app.route("/terms-of-use")
    def fn_terms_of_use():
        return render_template("legal/terms-of-use.html")

    @app.route("/cookie-policy")
    def fn_cookie_policy():
        return render_template("legal/cookie-policy.html")

    @app.route("/sw.js")
    def fn_service_worker():
        return send_from_directory("static/js", "sw.js", mimetype="application/javascript")

    @app.errorhandler(404)
    def fn_page_not_found(_not_found_error):
        return render_template("404.html"), 404

    return app


app = fn_create_app()


if __name__ == "__main__":
    app.run(debug=True)                                                 # turn offfffffff in prod
