import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-do-not-use-in-production") 
    MONGO_URI = os.environ.get("MONGO_URI")                                 # mongodb connection string

    SESSION_COOKIE_HTTPONLY = True                                          # js cannot read cookie
    SESSION_COOKIE_SAMESITE = "Lax"                                         # browser can only send cookie on same site requests
    SESSION_COOKIE_SECURE = os.environ.get("FLASK_ENV") == "production"     # in prod cookie is only sent over https
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)                          # cookies only last for 7 days 
