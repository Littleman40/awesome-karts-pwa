from flask import Flask, render_template, send_from_directory, session, redirect

from config import Config
from extensions import mongo
from models.user import fn_ensure_db_indexes, fn_find_user_by_id
from routes.auth import auth_bp


def fn_create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    mongo.init_app(app)

    with app.app_context():
        try:
            fn_ensure_db_indexes(mongo)
        except Exception as index_error:
            app.logger.warning(f"Could not ensure MongoDB indexes: {index_error}")

    app.register_blueprint(auth_bp)

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
