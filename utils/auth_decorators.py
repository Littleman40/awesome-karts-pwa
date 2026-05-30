# route decorators that protect login required and admin only endpoints
from functools import wraps
from flask import session, jsonify, redirect, request


# wraps any route so unauthenticated callers get a 401 (api) or are redirected to /login (pages)
def fn_login_required(route_function):
    @wraps(route_function)
    def fn_decorated_route(*args, **kwargs):
        if "user_id" not in session:

            # api callers get a json error, page routes get a redirect
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Login required"}), 401
            return redirect("/login")
        return route_function(*args, **kwargs)
    return fn_decorated_route


# same pattern as fn_login_required but checks for admin_id instead of user_id
def fn_admin_required(route_function):
    @wraps(route_function)
    def fn_decorated_route(*args, **kwargs):
        if "admin_id" not in session:

            # api callers get a json error - admin page routes get a redirect
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Admin access required"}), 401
            return redirect("/admin/login")
        return route_function(*args, **kwargs)
    return fn_decorated_route
