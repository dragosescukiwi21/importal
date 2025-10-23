from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi_users.exceptions import UserNotExists
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.core.config import settings
from app.schemas.user import UserRead, UserCreate, UserUpdate
from app.schemas.auth import RefreshTokenRequest, PasswordResetRequest
from app.models.user import User as UserModel
from app.schemas.user import UserReadWithApiKey
from app.services.plan_limits import plan_limits_service

from app.auth.users import (
    UserManager,
    fastapi_users,
    cookie_backend,
    get_user_manager,
    get_jwt_strategy,
    get_current_active_user as current_active_user,
)
from app.auth.token import (
    verify_refresh_token,
    revoke_token,
    revoke_all_user_tokens,
)

router = APIRouter()


# Custom login endpoint that returns both access and refresh tokens
@router.post("/login", response_model=Dict[str, Any])
async def login(
    credentials: OAuth2PasswordRequestForm = Depends(),
    user_manager: UserManager = Depends(get_user_manager),
    db: Session = Depends(get_db),
):
    """Login with username/password and get both access and refresh tokens"""
    try:
        # Use the standard FastAPI-Users authentication
        user = await user_manager.authenticate(credentials)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_BAD_CREDENTIALS",
            )

        # Get the access token - using the JWT strategy directly
        strategy = get_jwt_strategy()
        access_token = await strategy.write_token(user)

        # Generate a refresh token
        from app.auth.token import create_refresh_token

        refresh_token = create_refresh_token(user.id)

        # Return both tokens
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "refresh_token": refresh_token,
        }
    except Exception as e:
        print(f"Login error: {str(e)}")
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LOGIN_BAD_CREDENTIALS",
        )


# API key existence endpoint: returns { api_key: 'exists' } if user has an API key, else null
@router.get("/api-key", response_model=Dict[str, str])
async def get_api_key(user: UserModel = Depends(current_active_user)):
    """
    Returns { api_key: 'exists' } if the user has an API key, else { api_key: None }.
    """
    if user.hashed_api_key:
        return {"api_key": "exists"}
    return {"api_key": None}



@router.post("/jwt/login-with-refresh", response_model=Dict[str, Any])
async def login_with_refresh(
    credentials: OAuth2PasswordRequestForm = Depends(),
    user_manager: UserManager = Depends(get_user_manager),
    db: Session = Depends(get_db),
):
    """Login with username/password and get both access and refresh tokens"""
    try:
        # Use the standard FastAPI-Users authentication
        user = await user_manager.authenticate(credentials)
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="LOGIN_BAD_CREDENTIALS",
            )

        # Get the access token - using the JWT strategy directly
        strategy = get_jwt_strategy()
        access_token = await strategy.write_token(user)

        # Generate a refresh token
        from app.auth.token import create_refresh_token

        refresh_token = create_refresh_token(user.id)

        # Return both tokens
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "refresh_token": refresh_token,
        }
    except Exception as e:
        print(f"Login error: {str(e)}")
        import traceback

        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LOGIN_BAD_CREDENTIALS",
        )


# Cookie Authentication (for web applications)
router.include_router(
    fastapi_users.get_auth_router(cookie_backend),
    prefix="",
    tags=["Authentication"],
)


# Custom registration endpoint to ensure api_key is always present in response
from fastapi import Body
from app.schemas.user import UserCreate
from app.db.base import get_db
from sqlalchemy.orm import Session




@router.post("/register", response_model=UserReadWithApiKey, tags=["Authentication"])
async def custom_register(
    request: Request,
    user_create: UserCreate = Body(...),
    user_manager: UserManager = Depends(get_user_manager),
):
    try:
        await user_manager.get_by_email(user_create.email)
        raise HTTPException(status_code=400, detail="User already exists")
    except UserNotExists:
        user = await user_manager.create(user_create, safe=True, request=request)
        return UserReadWithApiKey(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            updated_at=getattr(user, "updated_at", None),
            api_key=None,
        )

# Include the FastAPI-Users reset password router
router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="/reset-password",
    tags=["auth"],
)

# Email verification
router.include_router(
    fastapi_users.get_verify_router(UserRead),
    prefix="/verify",
    tags=["auth"],
)

# User management
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)



@router.post("/regenerate-api-key", response_model=Dict[str, str])
async def regenerate_api_key(
    user: UserModel = Depends(current_active_user),
    user_manager: UserManager = Depends(get_user_manager),
):
    """
    Generates a new API key for the user, invalidating the old one (or creates one if none exists).
    Returns the new plaintext API key.
    """
    new_api_key = await user_manager.regenerate_api_key(user)
    return {"api_key": new_api_key}



# Custom endpoint to get current user info
@router.get("/me", response_model=UserRead)
async def get_current_user_info(
    user: UserModel = Depends(current_active_user),
):
    """
    Get the current user's information
    """
    return user


@router.get("/usage")
async def get_usage_info(
    user: UserModel = Depends(current_active_user),
    db: Session = Depends(get_db),
):
    """
    Get the current user's plan usage information
    """
    return plan_limits_service.get_usage_summary(db, user)


@router.post("/change-plan")
async def change_plan(
    plan_type: str,
    user: UserModel = Depends(current_active_user),
    db: Session = Depends(get_db),
):
    """
    Change user's plan (testing endpoint - will be replaced with Stripe integration)
    """
    from app.models.user import PlanType
    
    # Validate plan type
    try:
        new_plan = PlanType(plan_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid plan type. Must be one of: {[p.value for p in PlanType]}")
    
    # Get the user from the current database session to avoid session issues
    db_user = db.query(UserModel).filter(UserModel.id == user.id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update user's plan
    db_user.plan_type = new_plan
    db.commit()
    db.refresh(db_user)
    
    return {
        "message": f"Plan changed to {new_plan.value}",
        "new_plan": new_plan.value
    }


@router.post("/reset-monthly-usage")
async def reset_monthly_usage(
    user: UserModel = Depends(current_active_user),
    db: Session = Depends(get_db),
):
    """
    Reset monthly import usage (testing endpoint - normally done automatically each month)
    """
    from datetime import datetime
    from app.models.import_job import ImportJob
    
    # Get the start of the current month
    now = datetime.utcnow()
    start_of_month = datetime(now.year, now.month, 1)
    
    # Count and delete current month's import jobs for this user
    try:
        deleted_count = db.query(ImportJob).filter(
            ImportJob.user_id == user.id,
            ImportJob.created_at >= start_of_month
        ).delete(synchronize_session=False)
        
        db.commit()
        
        return {
            "message": f"Reset monthly usage. Deleted {deleted_count} import jobs from this month.",
            "deleted_imports": deleted_count
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error resetting usage: {str(e)}")
