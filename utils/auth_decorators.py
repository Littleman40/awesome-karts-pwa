# used later to protect routes that require login or admin access so we dont repeat ourselfs over and over and over and over again
from functools import wraps
from flask import session, jsonify, redirect, request


def fn_login_required(route_function):
    @wraps(route_function)
    def fn_decorated_route(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Login required"}), 401
            return redirect("/login")
        return route_function(*args, **kwargs)
    return fn_decorated_route


def fn_admin_required(route_function):
    @wraps(route_function)
    def fn_decorated_route(*args, **kwargs):
        if "admin_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Admin access required"}), 401
            return redirect("/admin/login")
        return route_function(*args, **kwargs)
    return fn_decorated_route
