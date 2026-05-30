# our email service 
from datetime import datetime, timedelta

from flask import current_app, render_template
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from extensions import mongo
from models.booking import fn_format_hour_label, PACKAGE_LABELS
from models.settings import fn_get_or_create_settings


# joins first + last into a single display name, tolerating missing parts
def fn_full_name(user_doc):
    first_name = user_doc.get("first_name", "")
    last_name = user_doc.get("last_name", "")
    return (first_name + " " + last_name).strip()


# turns an integer number of cents into a "$37.50" style string for templates
def fn_format_money_cents(amount_cents):
    if not isinstance(amount_cents, int):
        amount_cents = 0
    return "${:,.2f}".format(amount_cents / 100)


# six-character uppercase booking reference, eg the booking id "...a1b2c3" becomes "A1B2C3"
def fn_booking_ref(booking_doc):
    return str(booking_doc["_id"])[-6:].upper()


# APP_BASE_URL is reused for email links; strip any trailing slash so we don't build "//bookings/..."
def fn_base_url():
    configured = current_app.config.get("APP_BASE_URL", "")
    return configured.rstrip("/")


# pulls the business contact details every email footer needs from the single settings doc
def fn_get_business_contact():
    settings = fn_get_or_create_settings(mongo)
    return {
        "phone": settings.get("phone", ""),
        "email": settings.get("email", ""),
        "address": settings.get("address", ""),
    }


# renders an email template, auto-injecting the business contact block so every footer is populated
def fn_render_email(template_name, **context):
    if "business" not in context:
        context["business"] = fn_get_business_contact()
    return render_template("emails/" + template_name, **context)



# central send function - logs every attempt to email_logs and returns True on success, False on failure (never raises)
def fn_send_email(to_email, to_name, subject, html_body, email_type, booking_id=None, user_id=None):
    api_key = current_app.config.get("SENDGRID_API_KEY", "")
    from_email = current_app.config.get("SENDGRID_FROM_EMAIL")
    from_name = current_app.config.get("SENDGRID_FROM_NAME")

    log_doc = {
        "type": email_type,
        "recipient_email": to_email,
        "user_id": user_id,
        "booking_id": booking_id,
        "subject": subject,
        "sent_at": datetime.utcnow(),
        "status": "pending",
        "sendgrid_message_id": None,
        "error": None,
    }

    # for testing when no api key is present
    if not api_key:
        current_app.logger.info(f"[email-dev] Would send '{subject}' to {to_email}")
        log_doc["status"] = "skipped_no_key"
        mongo.db.email_logs.insert_one(log_doc)
        return True

    message = Mail(
        from_email=(from_email, from_name),
        to_emails=(to_email, to_name),
        subject=subject,
        html_content=html_body,
    )
    try:
        sendgrid_client = SendGridAPIClient(api_key)
        response = sendgrid_client.send(message)
        log_doc["status"] = "sent"
        log_doc["sendgrid_message_id"] = response.headers.get("X-Message-Id")
        mongo.db.email_logs.insert_one(log_doc)
        return True
    except Exception as send_error:
        current_app.logger.error(f"SendGrid send failed ({email_type} to {to_email}): {send_error}")
        log_doc["status"] = "failed"
        log_doc["error"] = str(send_error)
        mongo.db.email_logs.insert_one(log_doc)
        return False


# booking confirmation - sent after stripe marks something as paid
def fn_send_booking_confirmation(booking_doc, user_doc):
    booking_ref = fn_booking_ref(booking_doc)
    share_token = booking_doc.get("share_token", "")
    share_url = f"{fn_base_url()}/bookings/share/{share_token}" if share_token else ""
    html_body = fn_render_email(
        "booking_confirmation.html",
        user=user_doc,
        booking=booking_doc,
        ref=booking_ref,
        date_label=booking_doc["date"].strftime("%A, %d %B %Y"),
        time_label=fn_format_hour_label(booking_doc["time_slot"]),
        package_label=PACKAGE_LABELS.get(booking_doc.get("package_id", ""), ""),
        amount_label=fn_format_money_cents(booking_doc.get("total_amount", 0)),
        share_url=share_url,
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject=f"Booking Confirmed - Awesome Karts (Ref: AK-{booking_ref})",
        html_body=html_body,
        email_type="booking_confirmation",
        booking_id=booking_doc["_id"],
        user_id=user_doc["_id"],
    )


# booking reminders sent at 9am to everyone in the booking
def fn_send_booking_reminder(booking_doc, user_doc):
    html_body = fn_render_email(
        "booking_reminder.html",
        user=user_doc,
        booking=booking_doc,
        date_label=booking_doc["date"].strftime("%A, %d %B %Y"),
        time_label=fn_format_hour_label(booking_doc["time_slot"]),
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject="Reminder: Your Awesome Karts booking is tomorrow!",
        html_body=html_body,
        email_type="booking_reminder",
        booking_id=booking_doc["_id"],
        user_id=user_doc["_id"],
    )


# cancellations of bookings, which are sent to the user who created it
def fn_send_booking_cancelled(booking_doc, user_doc, was_paid=False):
    booking_ref = fn_booking_ref(booking_doc)
    html_body = fn_render_email(
        "booking_cancelled.html",
        user=user_doc,
        booking=booking_doc,
        ref=booking_ref,
        date_label=booking_doc["date"].strftime("%A, %d %B %Y"),
        time_label=fn_format_hour_label(booking_doc["time_slot"]),
        was_paid=was_paid,
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject=f"Booking Cancelled - Awesome Karts (Ref: AK-{booking_ref})",
        html_body=html_body,
        email_type="booking_cancelled",
        booking_id=booking_doc["_id"],
        user_id=user_doc["_id"],
    )


# refund emails
def fn_send_refund_confirmation(booking_doc, user_doc):
    booking_ref = fn_booking_ref(booking_doc)
    html_body = fn_render_email(
        "booking_refunded.html",
        user=user_doc,
        booking=booking_doc,
        ref=booking_ref,
        date_label=booking_doc["date"].strftime("%A, %d %B %Y"),
        time_label=fn_format_hour_label(booking_doc["time_slot"]),
        amount_label=fn_format_money_cents(booking_doc.get("total_amount", 0)),
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject=f"Refund Processed - Awesome Karts (Ref: AK-{booking_ref})",
        html_body=html_body,
        email_type="booking_refunded",
        booking_id=booking_doc["_id"],
        user_id=user_doc["_id"],
    )


# admin created bookings email's
def fn_send_admin_created_booking(booking_doc, user_doc):
    booking_ref = fn_booking_ref(booking_doc)
    share_token = booking_doc.get("share_token", "")
    share_url = f"{fn_base_url()}/bookings/share/{share_token}" if share_token else ""
    html_body = fn_render_email(
        "booking_admin_created.html",
        user=user_doc,
        booking=booking_doc,
        ref=booking_ref,
        date_label=booking_doc["date"].strftime("%A, %d %B %Y"),
        time_label=fn_format_hour_label(booking_doc["time_slot"]),
        package_label=PACKAGE_LABELS.get(booking_doc.get("package_id", ""), ""),
        amount_label=fn_format_money_cents(booking_doc.get("total_amount", 0)),
        share_url=share_url,
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject=f"A Booking Has Been Created For You - Awesome Karts (Ref: AK-{booking_ref})",
        html_body=html_body,
        email_type="booking_admin_created",
        booking_id=booking_doc["_id"],
        user_id=user_doc["_id"],
    )


# password resets
def fn_send_password_reset(user_doc, token):
    reset_url = f"{fn_base_url()}/reset-password?token={token}"
    html_body = fn_render_email(
        "password_reset.html",
        user=user_doc,
        reset_url=reset_url,
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject="Reset your Awesome Karts password",
        html_body=html_body,
        email_type="password_reset",
        user_id=user_doc["_id"],
    )


# password changed
def fn_send_password_changed(user_doc):
    # AEST is UTC+10; the stored timestamps are UTC so add 10 hours for a friendly local time
    changed_at_label = (datetime.utcnow() + timedelta(hours=10)).strftime("%d %B %Y at %I:%M %p AEST")
    html_body = fn_render_email(
        "password_changed.html",
        user=user_doc,
        changed_at_label=changed_at_label,
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject="Your Awesome Karts password was changed",
        html_body=html_body,
        email_type="password_changed",
        user_id=user_doc["_id"],
    )


# account creation
def fn_send_welcome(user_doc):
    html_body = fn_render_email(
        "welcome.html",
        user=user_doc,
        dashboard_url=f"{fn_base_url()}/dashboard",
    )
    return fn_send_email(
        to_email=user_doc["email"],
        to_name=fn_full_name(user_doc),
        subject="Welcome to Awesome Karts!",
        html_body=html_body,
        email_type="welcome",
        user_id=user_doc["_id"],
    )


# account deletion
def fn_send_account_deleted(email, first_name):
    html_body = fn_render_email(
        "account_deleted.html",
        first_name=first_name,
        register_url=f"{fn_base_url()}/register",
    )
    return fn_send_email(
        to_email=email,
        to_name=first_name,
        subject="Your Awesome Karts account has been deleted",
        html_body=html_body,
        email_type="account_deleted",
    )
