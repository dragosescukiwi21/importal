"""
Stripe service for handling subscriptions and payment processing.
"""
import stripe
import logging
from typing import Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from app.config.stripe_config import (
    STRIPE_SECRET_KEY, 
    PLAN_TO_STRIPE_MAPPING,
    PRICE_ID_TO_PLAN
)
from app.models.user import User, PlanType

logger = logging.getLogger(__name__)

# Configure Stripe
stripe.api_key = STRIPE_SECRET_KEY

class StripeService:
    """Service for handling Stripe operations."""
    
    def __init__(self):
        self.stripe = stripe
    
    def create_checkout_session(
        self, 
        user: User, 
        plan_type: PlanType,
        success_url: str,
        cancel_url: str
    ) -> Dict[str, Any]:
        """
        Create Stripe Checkout session for subscriptions.
        
        Args:
            user: User subscribing
            plan_type: Plan type to subscribe to
            success_url: Success redirect URL
            cancel_url: Cancel redirect URL
            
        Returns:
            Dict containing checkout session info
        """
        if plan_type not in PLAN_TO_STRIPE_MAPPING:
            raise ValueError(f"Plan type {plan_type} not found in Stripe mapping")
        
        stripe_mapping = PLAN_TO_STRIPE_MAPPING[plan_type]
        
        try:
            customer = self._get_or_create_customer(user)
            
            session = self.stripe.checkout.Session.create(
                customer=customer.id,
                payment_method_types=['card'],
                line_items=[{'price': stripe_mapping['price_id'], 'quantity': 1}],
                mode='subscription',
                success_url=success_url + '&session_id={CHECKOUT_SESSION_ID}',
                cancel_url=cancel_url,
                metadata={'user_id': str(user.id), 'plan_type': plan_type.value},
                subscription_data={'metadata': {'user_id': str(user.id), 'plan_type': plan_type.value}},
                allow_promotion_codes=True
            )
            
            return {
                'session_id': session.id,
                'checkout_url': session.url
            }
            
        except Exception as e:
            logger.error(f"Failed to create checkout session: {str(e)}")
            raise
    
    
    def _get_or_create_customer(self, user: User) -> stripe.Customer:
        """Get or create a Stripe customer for the user."""
        try:
            # Try to find existing customer by email
            customers = self.stripe.Customer.list(email=user.email, limit=1)
            
            if customers.data:
                return customers.data[0]
            
            # Create new customer
            customer = self.stripe.Customer.create(
                email=user.email,
                name=user.full_name,
                metadata={
                    'user_id': str(user.id)
                }
            )
            
            return customer
            
        except Exception as e:
            logger.error(f"Failed to get/create customer: {str(e)}")
            raise
    
    def create_customer_portal_session(
        self, 
        user: User, 
        return_url: str
    ) -> Dict[str, str]:
        """
        Create a customer portal session for managing subscriptions.
        
        Args:
            user: User accessing the portal
            return_url: URL to return to after portal session
            
        Returns:
            Dict with portal URL
        """
        try:
            customer = self._get_or_create_customer(user)
            
            session = self.stripe.billing_portal.Session.create(
                customer=customer.id,
                return_url=return_url
            )
            
            return {'portal_url': session.url}
            
        except Exception as e:
            logger.error(f"Failed to create portal session: {str(e)}")
            raise
    
    
    def handle_webhook_event(
        self, 
        event_type: str, 
        event_data: Dict[str, Any],
        db: Session
    ) -> bool:
        """
        Handle Stripe webhook events.
        
        Args:
            event_type: Type of webhook event
            event_data: Event data from Stripe
            db: Database session
            
        Returns:
            True if handled successfully, False otherwise
        """
        try:
            if event_type == 'checkout.session.completed':
                return self._handle_checkout_completed(event_data, db)
            elif event_type == 'invoice.payment_succeeded':
                return self._handle_payment_succeeded(event_data, db)
            elif event_type == 'customer.subscription.updated':
                return self._handle_subscription_updated(event_data, db)
            elif event_type == 'customer.subscription.deleted':
                return self._handle_subscription_deleted(event_data, db)
            else:
                logger.info(f"Unhandled webhook event type: {event_type}")
                return True
                
        except Exception as e:
            logger.error(f"Failed to handle webhook event {event_type}: {str(e)}")
            return False
    
    def _handle_checkout_completed(self, event_data: Dict[str, Any], db: Session) -> bool:
        """Handle successful checkout completion."""
        session = event_data['object']
        user_id = session['metadata'].get('user_id')
        plan_type_str = session['metadata'].get('plan_type')
        
        logger.info(f"Processing checkout completed for user {user_id}, plan {plan_type_str}")
        
        if not user_id or not plan_type_str:
            logger.error("Missing user_id or plan_type in checkout session metadata")
            return False
        
        try:
            plan_type = PlanType(plan_type_str)
            # Convert string user_id to UUID for comparison
            from uuid import UUID
            user_uuid = UUID(user_id)
            user = db.query(User).filter(User.id == user_uuid).first()
            
            if not user:
                logger.error(f"User not found: {user_id}")
                return False
            
            logger.info(f"Before update: User {user_id} plan is {user.plan_type}")
            
            # Update user's plan
            user.plan_type = plan_type
            db.commit()
            db.refresh(user)
            
            logger.info(f"✅ After update: User {user_id} plan is {user.plan_type}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update user plan: {str(e)}")
            db.rollback()
            return False
    
    def _handle_payment_succeeded(self, event_data: Dict[str, Any], db: Session) -> bool:
        """Handle successful payment."""
        invoice = event_data['object']
        subscription_id = invoice['subscription']
        
        try:
            # Retrieve subscription to get metadata
            subscription = self.stripe.Subscription.retrieve(subscription_id)
            user_id = subscription['metadata'].get('user_id')
            
            if user_id:
                logger.info(f"Payment succeeded for user {user_id}, subscription {subscription_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to handle payment success: {str(e)}")
            return False
    
    def _handle_subscription_updated(self, event_data: Dict[str, Any], db: Session) -> bool:
        """Handle subscription updates."""
        subscription = event_data['object']
        user_id = subscription['metadata'].get('user_id')
        
        logger.info(f"Processing subscription update for user {user_id}")
        
        if not user_id:
            return True
        
        try:
            # Get the price ID from the subscription
            price_id = subscription['items']['data'][0]['price']['id']
            
            logger.info(f"Subscription price_id: {price_id}")
            
            # Map price ID to plan type
            if price_id in PRICE_ID_TO_PLAN:
                plan_type = PRICE_ID_TO_PLAN[price_id]
                
                # Convert string user_id to UUID for comparison
                from uuid import UUID
                user_uuid = UUID(user_id)
                user = db.query(User).filter(User.id == user_uuid).first()
                if user:
                    logger.info(f"Before update: User {user_id} plan is {user.plan_type}")
                    
                    user.plan_type = plan_type
                    db.commit()
                    db.refresh(user)
                    
                    logger.info(f"✅ After update: User {user_id} plan is {user.plan_type}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to handle subscription update: {str(e)}")
            db.rollback()
            return False
    
    def _handle_subscription_deleted(self, event_data: Dict[str, Any], db: Session) -> bool:
        """Handle subscription cancellation."""
        subscription = event_data['object']
        user_id = subscription['metadata'].get('user_id')
        
        if not user_id:
            return True
        
        try:
            # Convert string user_id to UUID for comparison
            from uuid import UUID
            user_uuid = UUID(user_id)
            user = db.query(User).filter(User.id == user_uuid).first()
            if user:
                # Revert to free plan
                user.plan_type = PlanType.FREE
                db.commit()
                logger.info(f"Reverted user {user_id} to FREE plan due to subscription cancellation")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to handle subscription deletion: {str(e)}")
            db.rollback()
            return False

# Global service instance
stripe_service = StripeService()