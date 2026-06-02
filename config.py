import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-do-not-use-in-production")

    FLASK_ENV = os.environ.get("FLASK_ENV", "development")

    MONGO_URI = os.environ.get("MONGO_URI")

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("FLASK_ENV") == "production"
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)

    STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
    STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
    STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5000")

    SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
    SENDGRID_FROM_EMAIL = os.environ.get("SENDGRID_FROM_EMAIL", "noreply@awesomekarts.com.au")
    SENDGRID_FROM_NAME = os.environ.get("SENDGRID_FROM_NAME", "Awesome Karts")
    CONTACT_TO_EMAIL = os.environ.get("CONTACT_TO_EMAIL", os.environ.get("SENDGRID_FROM_EMAIL", "noreply@awesomekarts.com.au"))
