"""
Stripe API endpoints for subscription management.
"""
import logging
import json
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.models.user import User, PlanType
from app.services.stripe_service import stripe_service
from app.config.stripe_config import STRIPE_WEBHOOK_SECRET
from app.auth.users import get_current_active_user as get_current_user
import stripe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stripe", tags=["stripe"])


class CreateCheckoutSessionRequest(BaseModel):
    """Request model for creating checkout session."""
    plan_type: PlanType
    success_url: str = "http://localhost:3000/settings?success=true"
    cancel_url: str = "http://localhost:3000/settings?cancelled=true"


class CreatePortalSessionRequest(BaseModel):
    """Request model for creating portal session."""
    return_url: str = "http://localhost:3000/settings"


@router.post("/create-checkout-session")
async def create_checkout_session(
    request: CreateCheckoutSessionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create Stripe Checkout session for plan subscription/upgrade."""
    try:
        if request.plan_type == PlanType.FREE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create checkout session for FREE plan"
            )
        
        session_data = stripe_service.create_checkout_session(
            user=current_user,
            plan_type=request.plan_type,
            success_url=request.success_url,
            cancel_url=request.cancel_url
        )
        
        return session_data
        
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create checkout session: {str(e)}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create checkout session")
        current_user.plan_type = request.plan_type
        db.commit()
        
        logger.info(f"Updated user {current_user.id} to plan {request.plan_type}")
        
        return {
            "status": "success",
            "message": f"Subscription updated to {request.plan_type.value}",
            "plan_type": request.plan_type.value,
            "update_result": update_result
        }
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to update subscription: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update subscription"
        )


@router.get("/config")
async def get_stripe_config():
    """Get Stripe configuration for frontend."""
    from app.config.stripe_config import STRIPE_PUBLISHABLE_KEY
    
    return {
        "publishable_key": STRIPE_PUBLISHABLE_KEY
    }


@router.get("/debug/user-subscriptions")
async def debug_user_subscriptions(
    current_user: User = Depends(get_current_user)
):
    """Debug endpoint to see user's Stripe subscriptions."""
    try:
        # Get or create customer
        customer_email = current_user.email
        customers = stripe.Customer.list(email=customer_email, limit=1)
        
        if not customers.data:
            return {"message": "No Stripe customer found"}
        
        customer = customers.data[0]
        
        # Get all subscriptions for this customer
        subscriptions = stripe.Subscription.list(customer=customer.id)
        
        result = {
            "user_id": str(current_user.id),
            "user_plan_in_db": current_user.plan_type.value if current_user.plan_type else "None",
            "stripe_customer_id": customer.id,
            "subscriptions": []
        }
        
        for sub in subscriptions.data:
            sub_info = {
                "id": sub.id,
                "status": sub.status,
                "current_period_start": sub.current_period_start,
                "current_period_end": sub.current_period_end,
                "items": []
            }
            
            for item in sub.items.data:
                price = stripe.Price.retrieve(item.price.id)
                sub_info["items"].append({
                    "price_id": item.price.id,
                    "product_id": price.product,
                    "amount": price.unit_amount,
                    "currency": price.currency,
                    "quantity": item.quantity
                })
            
            result["subscriptions"].append(sub_info)
        
        return result
        
    except Exception as e:
        logger.error(f"Debug subscriptions error: {str(e)}")
        return {"error": str(e)}


class VerifyPaymentRequest(BaseModel):
    """Request model for payment verification."""
    session_id: str


@router.post("/verify-payment")
async def verify_payment(
    request: VerifyPaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify payment and update user plan immediately."""
    try:
        # Retrieve the session from Stripe
        session = stripe.checkout.Session.retrieve(request.session_id)
        
        logger.info(f"Verifying session {request.session_id} for user {current_user.id}")
        logger.info(f"Session status: {session.payment_status}, metadata: {session.metadata}")
        
        if session.payment_status == 'paid':
            plan_type_str = session.metadata.get('plan_type')
            session_user_id = session.metadata.get('user_id')
            
            if plan_type_str and session_user_id == str(current_user.id):
                plan_type = PlanType(plan_type_str)
                
                # Force update the user's plan immediately
                current_user.plan_type = plan_type
                db.commit()
                db.refresh(current_user)
                
                logger.info(f"✅ Successfully updated user {current_user.id} to plan {plan_type}")
                return {
                    "status": "success", 
                    "plan_type": plan_type.value,
                    "message": f"Plan updated to {plan_type.value}"
                }
            else:
                logger.warning(f"Session user {session_user_id} doesn't match current user {current_user.id}")
        
        return {"status": "no_update_needed", "payment_status": session.payment_status}
        
    except Exception as e:
        logger.error(f"Failed to verify payment: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to verify payment: {str(e)}"
        )


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')
    
    if not sig_header:
        logger.warning("Missing stripe-signature header")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing signature header"
        )
    
    try:
        # Verify webhook signature if webhook secret is configured
        if STRIPE_WEBHOOK_SECRET:
            event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        else:
            # For testing without webhook secret
            event = json.loads(payload.decode('utf-8'))
            logger.warning("Webhook signature verification skipped - no secret configured")
        
        # Handle the event
        event_type = event['type']
        event_data = event['data']
        
        success = stripe_service.handle_webhook_event(
            event_type=event_type,
            event_data=event_data,
            db=db
        )
        
        if success:
            return {"status": "success"}
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to process webhook event"
            )
            
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"Webhook signature verification failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid signature"
        )
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse webhook payload: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload"
        )
    except Exception as e:
        logger.error(f"Webhook processing failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook processing failed"
        )