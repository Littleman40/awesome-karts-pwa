# Awesome Karts

This is a full stack application built as my Year 12 NSW HSC Software Engineering Major Project. It will allow clients to create accounts, book karting sessions, sign up minors, complete mandatory waivers, and pay. With an extra admin panel for the staff members.


## Current Features
- [x] Static Pages
- [x] Log In/ Register System
- [x] User Dashboard 
- [x] Booking System

## Planned Updates
- [ ] Admin Management
- [ ] Payment System
- [ ] Notification System

## Screenshots
<img src="https://i.imgur.com/k5d4j7o.png" width=400> <img src="https://i.imgur.com/HSBztRV.png" width=400> <img src="https://i.imgur.com/YMDJDZW.png" width=400> <img src="https://i.imgur.com/n0y07Qv.png" width=400>

## Tech stack (so far)

- **Flask**: https://flask.palletsprojects.com/en/stable/
- **Jinja**: https://jinja.palletsprojects.com/en/stable/
- **Tailwind CSS**: https://tailwindcss.com/
- **MongoDB Atlas**: https://www.mongodb.com/atlas
- **bcrypt**: https://flask-bcrypt.readthedocs.io/en/1.0.1/

## run it locally

1. **clone/download the repo**
2. **install dependencies**
   ```bash
   pip install -r requirements.txt
   ```
3. **set up MongoDB Atlas**
4. **create a `.env` file**
5. **run the server**
   ```bash
   python app.py
   ```