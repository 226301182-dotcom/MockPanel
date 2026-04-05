# api/v1/sessions.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION FIXES:
#   1. Real JWT auth via get_current_user dependency — no more MOCK_USER_ID
#   2. All Supabase calls wrapped in asyncio.to_thread()
#   3. Resume upload validates PDF magic bytes, not just extension
#   4. Proper 404 vs 403 distinction (your session vs someone else's)
#   5. Rate limiting applied to create_session
#   6. Input sanitization on all string fields
#   7. ADDED: Delete Single Session & Delete All Sessions routes
# ════════════════════════════════════════════════════════════════════════════════

import asyncio
from fastapi import APIRouter, HTTPException, status, Request, UploadFile, File, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Any
from datetime import datetime

from services.pdf_parser import PDFParser
from db.redis_client import redis_cache
from db.supabase_client import get_global_supabase_client
from core.security import sanitize_input, get_current_user, rate_limit_check

router = APIRouter(tags=["sessions"])

# PDF magic bytes — first 5 bytes of every valid PDF
_PDF_MAGIC = b"%PDF-"
_MAX_RESUME_SIZE = 12 * 1024 * 1024   # 12 MB


# ════════════════════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════════════════════

class SessionCreate(BaseModel):
    domain:          Literal["upsc", "psu", "sde"]              = Field(..., description="Interview domain")
    mode:            Literal["interview", "coach"]               = Field(default="interview")
    topic:           Optional[str]                               = Field(default=None, max_length=120)
    name:            Optional[str]                               = Field(default=None, min_length=2, max_length=80)
    targetYear:      Optional[str]                               = Field(default=None, min_length=4, max_length=10)
    durationMinutes: int                                         = Field(default=40, ge=5, le=180)
    difficulty:      Literal["Easy", "Moderate", "Hard"]        = "Moderate"
    language:        Literal["English", "Hindi", "Hinglish"]    = "English"
    settings:        dict[str, Any]                              = Field(default_factory=dict)


class SessionResponse(BaseModel):
    session_id:  str
    user_id:     str
    domain:      str
    settings:    dict
    status:      str
    created_at:  datetime


class AnalyticsResponse(BaseModel):
    session_id:        str
    status:            str
    message:           Optional[str]  = None
    scores:            Optional[dict] = None
    analysis:          Optional[dict] = None
    question_analysis: Optional[list] = None
    stats:             Optional[dict] = None


# ════════════════════════════════════════════════════════════════════════════════
# DB HELPERS (async-safe)
# ════════════════════════════════════════════════════════════════════════════════

async def _db(fn) -> Any:
    """Run a synchronous Supabase call in a thread pool."""
    return await asyncio.to_thread(fn)


def _session_to_response(session: dict) -> dict:
    return {
        "session_id": session["id"],
        "user_id":    session["user_id"],
        "domain":     session["domain"],
        "settings":   session["settings"],
        "status":     session["status"],
        "created_at": session["created_at"],
    }


def _assert_owner(session: dict, user_id: str) -> None:
    """Raise 403 if session doesn't belong to requesting user."""
    if session.get("user_id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this session",
        )


# ════════════════════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════════════════════

@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body:         SessionCreate,
    request:      Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a new interview session.
    Requires valid JWT token (Bearer).
    Rate-limited to prevent abuse.
    """
    user_id = current_user["sub"]

    # Rate limit: 20 sessions per hour per user
    await rate_limit_check(request, user_id, limit=20)

    # Sanitize all string inputs
    name        = sanitize_input(body.name,       80)  if body.name       else None
    target_year = sanitize_input(body.targetYear, 20)  if body.targetYear else None
    topic       = sanitize_input(body.topic,      120) if body.topic      else None

    try:
        client = get_global_supabase_client()

        settings_payload: dict[str, Any] = dict(body.settings)
        settings_payload.update({
            "mode":            body.mode,
            "durationMinutes": body.durationMinutes,
            "difficulty":      body.difficulty,
            "language":        body.language,
        })
        if name:        settings_payload["name"]       = name
        if target_year: settings_payload["targetYear"] = target_year
        if topic:       settings_payload["topic"]      = topic

        data = {
            "user_id":     user_id,
            "domain":      body.domain.lower(),
            "name":        name,
            "language":    body.language,
            "target_year": target_year,
            "difficulty":  body.difficulty,
            "settings":    settings_payload,
            "status":      "created",
        }

        result = await _db(lambda: client.table("interviews").insert(data).execute())

        if not getattr(result, "data", None):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Database insert returned no data — check Supabase connection",
            )

        return SessionResponse(**_session_to_response(result.data[0]))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create session: {e}",
        )


@router.get("", response_model=List[SessionResponse])
async def list_sessions(
    current_user: dict = Depends(get_current_user),
):
    """List sessions belonging to the authenticated user."""
    user_id = current_user["sub"]
    try:
        client = get_global_supabase_client()
        result = await _db(
            lambda: client.table("interviews")
                          .select("*")
                          .eq("user_id", user_id)
                          .order("created_at", desc=True)
                          .limit(50)
                          .execute()
        )
        return [SessionResponse(**_session_to_response(s)) for s in (result.data or [])]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list sessions: {e}")


# ── DELETE ALL SESSIONS ───────────────────────────────────────────────────────
@router.delete("")
async def delete_all_sessions(
    current_user: dict = Depends(get_current_user),
):
    """Delete all sessions belonging to the authenticated user."""
    user_id = current_user["sub"]
    try:
        client = get_global_supabase_client()
        await _db(
            lambda: client.table("interviews")
                          .delete()
                          .eq("user_id", user_id)
                          .execute()
        )
        return {"message": "All sessions deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear history: {e}")


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id:   str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single session. Returns 403 if it belongs to a different user."""
    user_id = current_user["sub"]
    try:
        client = get_global_supabase_client()
        result = await _db(
            lambda: client.table("interviews").select("*").eq("id", session_id).execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        session = result.data[0]
        _assert_owner(session, user_id)
        return SessionResponse(**_session_to_response(session))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get session: {e}")


# ── DELETE SINGLE SESSION ─────────────────────────────────────────────────────
@router.delete("/{session_id}")
async def delete_session(
    session_id:   str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a specific session. Returns 403 if it belongs to a different user."""
    user_id = current_user["sub"]
    try:
        client = get_global_supabase_client()
        
        # 1. Verify existence and ownership
        result = await _db(
            lambda: client.table("interviews").select("id, user_id").eq("id", session_id).execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")
        
        _assert_owner(result.data[0], user_id)
        
        # 2. Delete from Supabase
        await _db(
            lambda: client.table("interviews").delete().eq("id", session_id).execute()
        )
        return {"message": f"Session {session_id} deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {e}")


@router.post("/{session_id}/resume", status_code=status.HTTP_201_CREATED)
async def upload_resume(
    session_id:   str,
    file:         UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Upload and parse a PDF resume/DAF for a session.
    FIX: Validates PDF magic bytes, not just file extension.
    """
    user_id = current_user["sub"]
    try:
        client = get_global_supabase_client()

        # Validate session exists and belongs to user
        result = await _db(
            lambda: client.table("interviews")
                          .select("id, user_id")
                          .eq("id", session_id)
                          .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Session not found")
        _assert_owner(result.data[0], user_id)

        # Read file
        file_content = await file.read()
        if len(file_content) > _MAX_RESUME_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 12 MB)")

        # Validate PDF magic bytes — extension check is trivially bypassed
        if not file_content.startswith(_PDF_MAGIC):
            raise HTTPException(
                status_code=400,
                detail="Invalid file format. Only PDF files are supported.",
            )

        # Parse text
        pdf_parser  = PDFParser()
        resume_text = pdf_parser.extract_text(file_content)

        if not resume_text.strip():
            raise HTTPException(
                status_code=400,
                detail="Could not extract text from PDF. "
                "Ensure the PDF is not scanned/image-only.",
            )

        # Cache in Redis
        await redis_cache.cache_resume_text(session_id, resume_text)

        return {
            "message":     "Resume uploaded and parsed successfully",
            "session_id":  session_id,
            "text_length": len(resume_text),
            "preview":     resume_text[:300] + "…" if len(resume_text) > 300 else resume_text,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process resume: {e}")


@router.get("/{session_id}/analytics", response_model=AnalyticsResponse)
async def get_session_analytics(
    session_id:   str,
    current_user: dict = Depends(get_current_user),
):
    """Get analytics for a completed session."""
    user_id = current_user["sub"]
    try:
        client = get_global_supabase_client()

        session_result = await _db(
            lambda: client.table("interviews")
                          .select("status, user_id")
                          .eq("id", session_id)
                          .execute()
        )
        if not session_result.data:
            raise HTTPException(status_code=404, detail="Session not found")

        _assert_owner(session_result.data[0], user_id)
        session_status = session_result.data[0]["status"]

        if session_status == "aborted_too_short":
            return AnalyticsResponse(
                session_id=session_id,
                status="aborted_too_short",
                message="Session was too short. Complete at least 2 full exchanges.",
            )

        if session_status in ("created", "active", "analyzing"):
            return AnalyticsResponse(
                session_id=session_id,
                status="processing",
                message="Analytics are being generated. Check back in a few seconds.",
            )

        analytics_result = await _db(
            lambda: client.table("final_analytics")
                          .select("*")
                          .eq("session_id", session_id)
                          .execute()
        )

        if not analytics_result.data:
            return AnalyticsResponse(
                session_id=session_id,
                status="processing",
                message="Analytics are being finalized.",
            )

        a = analytics_result.data[0]
        return AnalyticsResponse(
            session_id=session_id,
            status="completed",
            scores={
                "technical":         a.get("technical_score",         0),
                "communication":     a.get("communication_score",     0),
                "confidence":        a.get("confidence_score",        0),
                "ethical_integrity": a.get("ethical_integrity_score", 0),
                "overall":           a.get("overall_score",           0),
            },
            analysis={
                "strengths":       a.get("strengths",       []),
                "weaknesses":      a.get("weaknesses",      []),
                "recommendations": a.get("recommendations", []),
            },
            question_analysis=a.get("question_analysis", []),
            stats={
                "total_questions": a.get("total_questions",      0),
                "total_responses": a.get("total_user_responses", 0),
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve analytics: {e}")