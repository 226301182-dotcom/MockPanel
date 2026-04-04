# core/security.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION AUTH — bcrypt password hashing + JWT token lifecycle
# No dev bypass. No mock user. Real security only.
# ════════════════════════════════════════════════════════════════════════════════

import re
import time
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

pwd_context    = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme  = OAuth2PasswordBearer(
    tokenUrl="api/v1/auth/login",
    auto_error=False,   # Returns None instead of 401 — we handle it ourselves
)


# ════════════════════════════════════════════════════════════════════════════════
# PASSWORD HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def get_password_hash(password: str) -> str:
    """Hash password using bcrypt. Never store plain text passwords."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against stored bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


# ════════════════════════════════════════════════════════════════════════════════
# JWT TOKEN LIFECYCLE
# ════════════════════════════════════════════════════════════════════════════════

def create_access_token(data: dict) -> str:
    """
    Create a signed JWT access token.
    Expires in ACCESS_TOKEN_DAYS days.
    """
    to_encode = data.copy()
    expire    = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_DAYS)
    to_encode.update({
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    })
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """
    Verify and decode a JWT token.
    Raises HTTPException on invalid, expired, or tampered tokens.
    """
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
        # Log for monitoring but don't expose details to client
        logger.warning("JWT verification failed: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please login again.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ════════════════════════════════════════════════════════════════════════════════
# AUTH DEPENDENCY — used in all protected routes
# ════════════════════════════════════════════════════════════════════════════════

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """
    FastAPI dependency for protected routes.
    Usage: current_user: dict = Depends(get_current_user)

    Returns the JWT payload dict:
    {
        "sub":   "uuid-string",   # user_id
        "email": "user@email.com",
        "exp":   <timestamp>,
        "type":  "access"
    }
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please login.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_token(token)


# ════════════════════════════════════════════════════════════════════════════════
# RATE LIMITING (Redis-based)
# ════════════════════════════════════════════════════════════════════════════════

async def rate_limit_check(
    request: Request,
    user_id: str,
    limit:   int = 20,
) -> None:
    """
    Check if user has exceeded rate limit.
    Raises HTTP 429 if limit exceeded.
    Allows on Redis error (fail-open to avoid blocking legitimate users).
    """
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
    """
    Strip HTML tags and limit length.
    Prevents XSS and prompt injection via user-controlled strings.
    """
    if not text:
        return ""
    # Remove HTML/script tags
    clean = re.sub(r'<[^>]+>', '', text)
    # Remove null bytes
    clean = clean.replace('\x00', '')
    # Limit length
    return clean[:max_len].strip()


# ════════════════════════════════════════════════════════════════════════════════
# CLIENT IP HELPER
# ════════════════════════════════════════════════════════════════════════════════

def get_client_ip(request: Request) -> str:
    """Extract real client IP, respecting proxy headers."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"