# api/v1/auth.py
# ════════════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS — Signup, Login, Get Current User
# All Supabase calls wrapped in asyncio.to_thread() for async safety
# Passwords never stored in plain text — bcrypt only
# ════════════════════════════════════════════════════════════════════════════════

import asyncio
import uuid
import logging

from fastapi import APIRouter, HTTPException, status, Request, Depends
from pydantic import BaseModel, EmailStr, Field

from db.supabase_client import get_global_supabase_client
from core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    rate_limit_check,
    get_client_ip,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
logger = logging.getLogger("uvicorn")


# ════════════════════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════════════════════
# api/v1/auth.py mein models ko aise update karein

class SignupRequest(BaseModel):
    email: EmailStr
    password: str  # min_length hata kar test karein pehle
    name: str = "" # Default empty string taaki missing hone par crash na ho

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class AuthResponse(BaseModel):
    token:   str
    user_id: str
    email:   str
    name:    str


class UserResponse(BaseModel):
    user_id: str
    email:   str
    name:    str


# ════════════════════════════════════════════════════════════════════════════════
# DB HELPER
# ════════════════════════════════════════════════════════════════════════════════

async def _db(fn):
    """Run synchronous Supabase call in thread pool."""
    return await asyncio.to_thread(fn)


# ════════════════════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════════════════════

@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, request: Request):
    """
    Register a new user.
    - Checks for existing email
    - Hashes password with bcrypt
    - Returns JWT token immediately (auto-login after signup)
    """
    client_ip = get_client_ip(request)
    logger.info("Signup attempt from %s for %s", client_ip, body.email)

    client = get_global_supabase_client()

    # Check email uniqueness
    existing = await _db(
        lambda: client.table("users")
                       .select("id")
                       .eq("email", body.email)
                       .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists. Please login.",
        )

    # Create user
    user_id      = str(uuid.uuid4())
    hashed_pwd   = get_password_hash(body.password)
    display_name = body.name.strip() or body.email.split("@")[0]

    try:
        await _db(
            lambda: client.table("users").insert({
                "id":            user_id,
                "email":         body.email,
                "password_hash": hashed_pwd,
                "name":          display_name,
            }).execute()
        )
    except Exception as e:
        logger.error("User insert failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Account creation failed. Please try again.",
        )

    token = create_access_token({
        "sub":   user_id,
        "email": body.email,
        "name":  display_name,
    })

    logger.info("✅ User created: %s (%s)", user_id, body.email)
    return AuthResponse(
        token=token,
        user_id=user_id,
        email=body.email,
        name=display_name,
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, request: Request):
    """
    Authenticate existing user.
    - Constant-time password verification (prevents timing attacks)
    - Returns JWT token on success
    - Same error message for wrong email and wrong password (prevents enumeration)
    """
    client_ip = get_client_ip(request)
    logger.info("Login attempt from %s for %s", client_ip, body.email)

    client = get_global_supabase_client()

    result = await _db(
        lambda: client.table("users")
                       .select("id, email, name, password_hash")
                       .eq("email", body.email)
                       .execute()
    )

    # Same error for wrong email AND wrong password — prevents user enumeration
    _INVALID_ERR = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password. Please try again.",
    )

    if not result.data:
        # Still run verify to prevent timing attack
        get_password_hash("dummy_constant_time_check")
        raise _INVALID_ERR

    user = result.data[0]

    if not verify_password(body.password, user["password_hash"]):
        raise _INVALID_ERR

    token = create_access_token({
        "sub":   user["id"],
        "email": user["email"],
        "name":  user.get("name", ""),
    })

    logger.info("✅ Login success: %s", user["id"])
    return AuthResponse(
        token=token,
        user_id=user["id"],
        email=user["email"],
        name=user.get("name", ""),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Get currently authenticated user's info.
    Used by frontend AuthContext to validate stored token on app load.
    """
    return UserResponse(
        user_id=current_user["sub"],
        email=current_user.get("email", ""),
        name=current_user.get("name", ""),
    )