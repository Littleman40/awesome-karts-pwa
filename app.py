from flask import Flask, render_template, send_from_directory, session, redirect
from bson import ObjectId

from config import Config
from extensions import mongo
from models.user import fn_ensure_db_indexes, fn_find_user_by_id
from models.booking import fn_ensure_booking_indexes, fn_find_booking_by_share_token   # booking model / used for the share-link page and to create indexes on startup
from routes.auth import auth_bp
from routes.bookings import bookings_bp                                                # /api/bookings/* / slot lookups, create, share-add
from routes.users import users_bp                                                      # /api/users/me/* / dashboard data (bookings, minors, waivers)


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

    @app.context_processor
    def fn_inject_current_user():
        current_user = None
        if "user_id" in session:                                    # if session cookie exists look up user in db
            current_user = fn_find_user_by_id(mongo, session["user_id"])
            if current_user is None:                                # if user doesnt exist then log them out
                session.clear()
        return {"current_user": current_user}                       # now pages can now do {{ current_user.first_name }}


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
