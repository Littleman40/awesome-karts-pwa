# our stripe service
import os
import time

import stripe
from dotenv import load_dotenv

load_dotenv()
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")

# stripe hosted checkout expires after 30
CHECKOUT_SESSION_TTL_SECONDS = 30 * 60                                         


# used by routes to fail if keys aren't set yet
def fn_is_configured():                                                        
    return bool(stripe.api_key)


# create the stripe hosted checkout session then returns the information
def fn_create_checkout_session(amount_cents, product_name, description, success_url, cancel_url, customer_email, metadata):
    return stripe.checkout.Session.create(
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": "aud",
                "product_data": {
                    "name": product_name,
                    "description": description,
                },

                # stripe expects the amount in cents, same unit we store everywhere
                "unit_amount": amount_cents,                                   
            },
            "quantity": 1,
        }],
        mode="payment",
        success_url=success_url,
        cancel_url=cancel_url,

        # pre-fills the email field on the checkout page
        customer_email=customer_email,                  

        # booking_id + user_id travel with the event so the webhook can find the booking                       
        metadata=metadata,                                                     
        expires_at=int(time.time()) + CHECKOUT_SESSION_TTL_SECONDS,
    )


# refunds a payment, called by admins only
def fn_create_refund(payment_intent_id):
    return stripe.Refund.create(
        payment_intent=payment_intent_id,
        reason="requested_by_customer",
    )

# makes sure webhooks actually come from stripe
def fn_construct_webhook_event(payload, signature_header):
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    return stripe.Webhook.construct_event(payload, signature_header, webhook_secret)
