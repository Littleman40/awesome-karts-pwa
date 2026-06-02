import os
from datetime import datetime, timedelta

from flask import Flask, render_template, send_from_directory, session, redirect, request, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from bson import ObjectId

from config import Config
from extensions import mongo
from services import email_service
from models.user import fn_ensure_db_indexes, fn_find_user_by_id
from models.booking import fn_ensure_booking_indexes, fn_find_booking_by_share_token, fn_cleanup_abandoned_bookings
from models.admin import fn_find_admin_by_id
from routes.auth import auth_bp
from routes.bookings import bookings_bp
from routes.users import users_bp
from routes.admin_auth import admin_auth_bp
from routes.admin import admin_bp
from routes.payments import payments_bp


# cleans up abandonded bookings every 10 minutes, so they dont hold slot capacity forever
def fn_start_cleanup_scheduler(app):
    is_reloader_child = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    is_production = app.config.get("FLASK_ENV") == "production"
    if not (is_reloader_child or is_production):
        return

    from apscheduler.schedulers.background import BackgroundScheduler

    def fn_run_cleanup():
        with app.app_context():
            try:
                cleaned = fn_cleanup_abandoned_bookings(mongo)
                if cleaned:
                    app.logger.info(f"Cleanup released {cleaned} abandoned booking(s).")
            except Exception as cleanup_error:
                app.logger.warning(f"Abandoned-booking cleanup failed: {cleanup_error}")

    # sends an email reminder to every linked user the day before their booking
    def fn_run_daily_reminders():
        with app.app_context():
            try:
                # bookings store their date as a midnight datetime; work out "tomorrow" in AEST (UTC+10)
                now_aest = datetime.utcnow() + timedelta(hours=10)
                tomorrow_date = now_aest.date() + timedelta(days=1)
                target_datetime = datetime.combine(tomorrow_date, datetime.min.time())

                # only remind for bookings that are actually paid
                upcoming_bookings = list(mongo.db.bookings.find({
                    "date": target_datetime,
                    "payment_status": "paid",
                }))

                reminders_sent = 0
                for booking_doc in upcoming_bookings:
                    # one reminder per linked user per booking (same rule as SMS)
                    for linked_user_id in booking_doc.get("linked_user_ids", []):
                        linked_user_doc = mongo.db.users.find_one({"_id": linked_user_id})
                        if linked_user_doc is None:
                            continue
                        try:
                            email_service.fn_send_booking_reminder(booking_doc, linked_user_doc)
                            reminders_sent += 1
                        except Exception as single_reminder_error:
                            app.logger.warning(f"Reminder email failed for booking {booking_doc['_id']}: {single_reminder_error}")

                if reminders_sent:
                    app.logger.info(f"Sent {reminders_sent} booking reminder email(s) for {tomorrow_date}.")
            except Exception as reminder_job_error:
                app.logger.warning(f"Daily reminder job failed: {reminder_job_error}")

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(fn_run_cleanup, "interval", minutes=10, id="cleanup_abandoned_bookings")
    # 9am AEST every day - day-before reminders
    scheduler.add_job(fn_run_daily_reminders, "cron", hour=9, minute=0, timezone="Australia/Sydney", id="daily_booking_reminders")
    scheduler.start()


def fn_create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    if Config.FLASK_ENV == "production":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    mongo.init_app(app)

    with app.app_context():
        try:
            # unique index on users.email
            fn_ensure_db_indexes(mongo)         
            # unique compound index on slots.(date,hour) + unique share_token on bookings
            fn_ensure_booking_indexes(mongo)
            # TTL index so MongoDB auto-deletes expired password reset tokens
            mongo.db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
        except Exception as index_error:
            app.logger.warning(f"Could not ensure MongoDB indexes: {index_error}")

    app.register_blueprint(auth_bp)
    app.register_blueprint(bookings_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(admin_auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(payments_bp)

    # background job that auto-cancels abandoned bookings to free their slots
    fn_start_cleanup_scheduler(app)                                 

    @app.context_processor
    def fn_inject_current_user():
        current_user = None

        # if session cookie exists look up user in db
        if "user_id" in session:                                    
            current_user = fn_find_user_by_id(mongo, session["user_id"])
            
            # if user doesnt exist then log them out
            if current_user is None:                                
                session.clear()

        # mirror the same pattern for admin sessions so admin templates can use {{ current_admin.email }}
        current_admin = None                                        
        if "admin_id" in session:
            current_admin = fn_find_admin_by_id(mongo, session["admin_id"])

            # session points to a deleted admin - drop the cookie
            if current_admin is None:                               
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

    @app.route("/contact", methods=["POST"])
    def fn_contact_submit():
        data = request.get_json(silent=True) or {}
        name    = (data.get("name")    or "").strip()
        surname = (data.get("surname") or "").strip()
        email   = (data.get("email")   or "").strip()
        message = (data.get("message") or "").strip()

        if not all([name, surname, email, message]):
            return jsonify({"success": False, "error": "All fields are required."}), 400

        ok = email_service.fn_send_contact_enquiry(name, surname, email, message)
        if ok:
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "Could not send your message. Please try again later."}), 500

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

    @app.route("/forgot-password")
    def fn_forgot_password_page():
        if "user_id" in session:
            return redirect("/dashboard")
        return render_template("forgot_password.html")

    @app.route("/reset-password")
    def fn_reset_password_page():
        # token arrives from the email link: /reset-password?token=...
        return render_template("reset_password.html", token=request.args.get("token", ""))

    @app.route("/dashboard")
    def fn_dashboard():
        if "user_id" not in session:
            return redirect("/login")
        return render_template("dashboard.html")

    @app.route("/bookings")
    def fn_bookings():
        return render_template("bookings.html")

    @app.route("/bookings/success")
    def fn_booking_success():
        return render_template(
            "bookings_success.html",
            booking_id=request.args.get("booking_id", ""),
            share_token=request.args.get("token", ""),
        )

    @app.route("/bookings/cancelled")
    def fn_booking_cancelled():
        booking_id = request.args.get("booking_id", "")
        if booking_id:
            from models.booking import fn_release_pending_booking
            fn_release_pending_booking(mongo, booking_id)
        return redirect("/bookings")

    @app.route("/bookings/share/<share_token>")
    def fn_booking_share(share_token):
        booking = fn_find_booking_by_share_token(mongo, share_token)
        is_linked = False
        if booking is not None and "user_id" in session:
            try:
                current_user_object_id = ObjectId(session["user_id"])

                # already linked check
                if current_user_object_id in booking.get("linked_user_ids", []):
                    is_linked = True
            except Exception:
                # if the session user_id is malformed just treat them as not linked
                is_linked = False               

        # token also passed so the template can build the /login?next=... back-link                                                
        return render_template(                                                                 
            "bookings_share.html",
            booking=booking,
            share_token=share_token,
            is_linked=is_linked,
        )

    @app.route("/admin/login")
    def fn_admin_login_page():
        if "admin_id" in session:
            return redirect("/admin")
        return render_template("admin/login.html")

    @app.route("/admin")
    def fn_admin_dashboard_page():
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

    @app.route("/admin/customers/<user_id>")
    def fn_admin_customer_detail_page(user_id):
        if "admin_id" not in session:
            return redirect("/admin/login")
        return render_template("admin/customer_detail.html", user_id=user_id)

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
    app.run(debug=Config.FLASK_ENV != "production")
