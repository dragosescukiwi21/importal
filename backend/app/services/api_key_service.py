import secrets
import bcrypt
import logging

logger = logging.getLogger(__name__)

def generate_api_key():
    """Generates a secure random API key."""
    return secrets.token_urlsafe(32)

def hash_api_key(api_key: str) -> str:
    """Hashes an API key using bcrypt."""
    salt = bcrypt.gensalt()
    hashed_key = bcrypt.hashpw(api_key.encode('utf-8'), salt)
    return hashed_key.decode('utf-8')

def verify_api_key(api_key: str, hashed_key: str) -> bool:
    """Verifies a plaintext API key against a hashed key."""
    try:
        # Ensure the hashed key is properly encoded
        if isinstance(hashed_key, str):
            hashed_key_bytes = hashed_key.encode('utf-8')
        else:
            hashed_key_bytes = hashed_key
            
        result = bcrypt.checkpw(api_key.encode('utf-8'), hashed_key_bytes)
        return result
    except Exception as e:
        logger.error(f"Error during API key verification: {e}")
        return False
