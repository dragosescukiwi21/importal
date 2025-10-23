import logging
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from app.db.base import get_db
from app.models.user import User
from app.services.api_key_service import verify_api_key

logger = logging.getLogger(__name__)

async def get_current_user_by_api_key(request: Request, db: Session = Depends(get_db)) -> User:
    auth_header = request.headers.get("Authorization")
    
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid Authorization header")
    
    api_key = auth_header.split(" ", 1)[1].strip()
    
    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key required")

    potential_users = db.query(User).filter(User.hashed_api_key.isnot(None)).all()

    # Iterate through the users and check the provided key against each stored hash
    for user in potential_users:
        if verify_api_key(api_key, user.hashed_api_key):
            # Found the correct user
            if not user.is_active:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
            return user # Return the matched user

    # If the loop finishes, no user matched the key
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")

