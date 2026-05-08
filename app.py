from flask import Flask, render_template, send_from_directory, session, redirect

from config import Config
from extensions import mongo
from models.user import ensure_indexes, find_by_id
from routes.auth import auth_bp


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    mongo.init_app(app)

    with app.app_context():
        try:
            ensure_indexes(mongo)
        except Exception as e:
            app.logger.warning(f"Could not ensure MongoDB indexes: {e}")

    app.register_blueprint(auth_bp)

    @app.context_processor
    def inject_current_user():
        user = None
        if "user_id" in session:
            user = find_by_id(mongo, session["user_id"])
            if user is None:
                session.clear()
        return {"current_user": user}

    @app.route("/")
    def home():
        return render_template("index.html")

    @app.route("/pricing")
    def pricing():
        return render_template("pricing.html")

    @app.route("/track")
    def track():
        return render_template("track.html")

    @app.route("/contact")
    def contact():
        return render_template("contact.html")

    @app.route("/login")
    def login():
        if "user_id" in session:
            return redirect("/dashboard")
        return render_template("login.html")

    @app.route("/register")
    def register():
        if "user_id" in session:
            return redirect("/dashboard")
        return render_template("register.html")

    @app.route("/dashboard")
    def dashboard():
        if "user_id" not in session:
            return redirect("/login")
        return render_template("dashboard.html")

    @app.route("/bookings")
    def bookings():
        return render_template("bookings.html")

    @app.route("/refund-policy")
    def refund_policy():
        return render_template("legal/refund-policy.html")

    @app.route("/privacy-policy")
    def privacy_policy():
        return render_template("legal/privacy-policy.html")

    @app.route("/terms-of-use")
    def terms_of_use():
        return render_template("legal/terms-of-use.html")

    @app.route("/cookie-policy")
    def cookie_policy():
        return render_template("legal/cookie-policy.html")

    @app.route("/sw.js")
    def service_worker():
        return send_from_directory("static/js", "sw.js", mimetype="application/javascript")

    @app.errorhandler(404)
    def page_not_found(e):
        return render_template("404.html"), 404

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
