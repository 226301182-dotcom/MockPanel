# core/security.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION AUTH — bcrypt password hashing + JWT token lifecycle
# FIX: Added truncate_base64=True to handle bcrypt 72-character limit.
# ════════════════════════════════════════════════════════════════════════════════

import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from passlib.context import CryptContext

from core.config import settings

logger = logging.getLogger("uvicorn")

# ── Crypto config ──────────────────────────────────────────────────────────────
ALGORITHM          = "HS256"
ACCESS_TOKEN_DAYS  = 7          # Token valid for 7 days
REFRESH_TOKEN_DAYS = 30         # Refresh token valid for 30 days

# [FIX] truncate_base64=True prevents the "72 bytes" ValueError with newer bcrypt
pwd_context = CryptContext(
    schemes=["bcrypt"], 
    deprecated="auto",
    truncate_base64=True 
)

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="api/v1/auth/login",
    auto_error=False,
)


# ════════════════════════════════════════════════════════════════════════════════
# PASSWORD HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def get_password_hash(password: str) -> str:
    """Hash password using bcrypt. Never store plain text passwords."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against stored bcrypt hash."""
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False


# ════════════════════════════════════════════════════════════════════════════════
# JWT TOKEN LIFECYCLE
# ════════════════════════════════════════════════════════════════════════════════

def create_access_token(data: dict) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    expire    = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_DAYS)
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    })
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[ALGORITHM],
        )
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject claim",
            )
        return payload

    except JWTError as e:
        logger.warning("JWT verification failed: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please login again.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ════════════════════════════════════════════════════════════════════════════════
# AUTH DEPENDENCY
# ════════════════════════════════════════════════════════════════════════════════

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """FastAPI dependency for protected routes."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please login.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_token(token)


# ════════════════════════════════════════════════════════════════════════════════
# RATE LIMITING
# ════════════════════════════════════════════════════════════════════════════════

async def rate_limit_check(
    request: Request,
    user_id: str,
    limit:   int = 20,
) -> None:
    try:
        from db.redis_client import redis_cache
        allowed = await redis_cache.rate_limit_check(user_id, limit)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Rate limit check failed (allowing): %s", e)


# ════════════════════════════════════════════════════════════════════════════════
# INPUT SANITIZATION
# ════════════════════════════════════════════════════════════════════════════════

def sanitize_input(text: Optional[str], max_len: int = 500) -> str:
    if not text:
        return ""
    clean = re.sub(r'<[^>]+>', '', text)
    clean = clean.replace('\x00', '')
    return clean[:max_len].strip()


# ════════════════════════════════════════════════════════════════════════════════
# CLIENT IP HELPER
# ════════════════════════════════════════════════════════════════════════════════

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"