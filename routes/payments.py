# stripe payment routes
import stripe
from flask import Blueprint, request, current_app

from extensions import mongo
from models import booking as booking_model
from services import stripe_service
from services import email_service

# Stripe-facing endpoints live under /api/stripe - registered in app.py
payments_bp = Blueprint("payments", __name__, url_prefix="/api/stripe")         

# Stripe calls this server-to-server after a checkout finishes
@payments_bp.route("/webhook", methods=["POST"])                                
def fn_stripe_webhook():
    payload = request.get_data()
    signature_header = request.headers.get("Stripe-Signature", "")

    # no signing secret configured - we can't trust anything, so reject
    if not current_app.config.get("STRIPE_WEBHOOK_SECRET"):                     
        current_app.logger.error("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not set.")
        return "Webhook not configured", 500

    try:
        event = stripe_service.fn_construct_webhook_event(payload, signature_header)
    except ValueError:
        return "Invalid payload", 400
    except stripe.error.SignatureVerificationError:
        return "Invalid signature", 400

    event_type = event["type"]
    data_object = event["data"]["object"]

    def fn_field(stripe_obj, key, default=None):                               
        return stripe_obj[key] if (stripe_obj is not None and key in stripe_obj) else default

    def fn_booking_id_from(stripe_obj):
        metadata = fn_field(stripe_obj, "metadata", None)
        return fn_field(metadata, "booking_id", None)

    # payment succeeded - mark the booking paid
    if event_type == "checkout.session.completed":                             
        booking_id = fn_booking_id_from(data_object)
        payment_intent_id = fn_field(data_object, "payment_intent", None)
        if booking_id:
            updated_booking = booking_model.fn_mark_booking_paid(mongo, booking_id, payment_intent_id)
            if updated_booking is not None:
                current_app.logger.info(f"Booking {booking_id} marked paid via webhook.")

                # send the confirmation email to the booking creator - fire-and-forget so a send failure never breaks the webhook
                try:
                    creator_user = mongo.db.users.find_one({"_id": updated_booking.get("creator_user_id")})
                    if creator_user is not None:
                        email_service.fn_send_booking_confirmation(updated_booking, creator_user)
                except Exception as confirmation_email_error:
                    current_app.logger.warning(f"Booking confirmation email failed for {booking_id}: {confirmation_email_error}")

    # user abandoned checkout or payment failed - free the slot
    elif event_type in ("checkout.session.expired", "checkout.session.async_payment_failed"):   
        booking_id = fn_booking_id_from(data_object)
        if booking_id:
            booking_model.fn_release_pending_booking(mongo, booking_id)
            current_app.logger.info(f"Booking {booking_id} released (checkout {event_type}).")

    return "", 200
