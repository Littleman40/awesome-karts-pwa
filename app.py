from flask import Flask, render_template, send_from_directory

app = Flask(__name__)


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/pricing')
def pricing():
    return render_template('pricing.html')


@app.route('/track')
def track():
    return render_template('track.html')


@app.route('/contact')
def contact():
    return render_template('contact.html')


@app.route('/login')
def login():
    return render_template('login.html')


@app.route('/bookings')
def bookings():
    return render_template('bookings.html')


@app.route('/refund-policy')
def refund_policy():
    return render_template('legal/refund-policy.html')


@app.route('/privacy-policy')
def privacy_policy():
    return render_template('legal/privacy-policy.html')


@app.route('/terms-of-use')
def terms_of_use():
    return render_template('legal/terms-of-use.html')


@app.route('/cookie-policy')
def cookie_policy():
    return render_template('legal/cookie-policy.html')


@app.route('/sw.js')
def service_worker():
    return send_from_directory('static/js', 'sw.js', mimetype='application/javascript')


@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html'), 404


if __name__ == "__main__":
    app.run(debug=True)
