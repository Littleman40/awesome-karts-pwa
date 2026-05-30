# Awesome Karts

This is a full stack application built as my Year 12 NSW HSC Software Engineering Major Project. It will allow clients to create accounts, book karting sessions, sign up minors, complete mandatory waivers, and pay. With an extra admin panel for the staff members.


## Current Features
- [x] Static Pages
- [x] Log In/ Register System
- [x] User Dashboard 
- [x] Booking System
- [x] Admin Management
- [x] Payment System
- [x] Notification System


## Screenshots
<img src="https://i.imgur.com/QvON7qR.png" width=400> <img src="https://i.imgur.com/LV5t8Gm.png" width=400> <img src="https://i.imgur.com/t0xUBMt.png" width=400> <img src="https://i.imgur.com/s6NG25I.png" width=400>

## Tech stack

- **Flask**: https://flask.palletsprojects.com/en/stable/
- **Jinja**: https://jinja.palletsprojects.com/en/stable/
- **Tailwind CSS**: https://tailwindcss.com/
- **MongoDB Atlas**: https://www.mongodb.com/atlas
- **bcrypt**: https://flask-bcrypt.readthedocs.io/en/1.0.1/
- **Stripe**: https://stripe.com/docs
- **SendGrid**: https://docs.sendgrid.com/
- **APScheduler**: https://apscheduler.readthedocs.io/en/stable/
- **Gunicorn**: https://gunicorn.org/

## Run it locally

1. **clone/download the repo**
2. **install dependencies**
   ```bash
   pip install -r requirements.txt
   ```
3. **set up MongoDB Atlas**
4. **create a `.env` file from `.env.example`**
5. **create the admin account**
   ```bash
   python scripts/create_admin.py
   ```
6. **run the server**
   ```bash
   python app.py
   ```