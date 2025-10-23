import uuid
import logging
from typing import Optional

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, CookieTransport, JWTStrategy

from app.core.config import settings
from app.db.users import get_user_db
from app.models.user import User
from app.services.api_key_service import generate_api_key, hash_api_key

logger = logging.getLogger(__name__)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.SECRET_KEY
    verification_token_secret = settings.SECRET_KEY

    async def on_after_register(self, user: User, request: Optional[Request] = None):
        logger.info(f"User {user.id} has registered.")
        # Do not generate or assign an API key on registration. User starts with no API key.

    async def on_after_forgot_password(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        # In production, you would send an email here
        logger.info(f"User {user.id} has forgot their password. Reset token: {token}")

    async def regenerate_api_key(self, user: User) -> str:
        """
        Generates a new API key for the user, invalidating the old one.
        Returns the new plaintext API key.
        """
        new_api_key = generate_api_key()
        hashed_api_key = hash_api_key(new_api_key)

        await self.user_db.update(user, {"hashed_api_key": hashed_api_key})
        logger.info(f"Regenerated API key for user {user.email}.")

        return new_api_key

    async def on_after_request_verify(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        # In production, you would send an email here
        logger.info(f"Verification requested for user {user.id}. Verification token: {token}")


async def get_user_manager(user_db=Depends(get_user_db)):
    yield UserManager(user_db)


# Bearer transport for API access
bearer_transport = BearerTransport(tokenUrl=f"{settings.API_V1_STR}/auth/login")

# Cookie transport for web applications
cookie_transport = CookieTransport(
    cookie_name="importcsv_auth",
    cookie_max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    cookie_secure=settings.ENVIRONMENT == "production",  # Only send over HTTPS in production
    cookie_httponly=True,  # Prevent JavaScript access
    cookie_samesite="lax",  # CSRF protection
)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=settings.SECRET_KEY,
        lifetime_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        token_audience=["fastapi-users:auth"],
    )


# JWT Authentication backend for API access
jwt_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

# Cookie Authentication backend for web applications
cookie_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

# Create FastAPIUsers instance
fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [jwt_backend, cookie_backend])

# Export dependencies
get_current_user = fastapi_users.current_user()
get_current_active_user = fastapi_users.current_user(active=True)
get_current_superuser = fastapi_users.current_user(active=True, superuser=True)
get_optional_user = fastapi_users.current_user(optional=True)
