# api/v1/websockets.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION FIXES:
#   [WB-1]  Emergency token bypass REMOVED. Production uses real JWT only.
#           Dev mode: set BYPASS_AUTH=true in .env to allow token-less access.
#           Never deploy with BYPASS_AUTH=true.
#   [WB-2]  AudioService() instantiated ONCE per WS session (not per message).
#           Prevents connection pool exhaustion under load.
#   [WB-3]  mime_type forwarded from audio_chunk to stt_stream() so audio_service
#           gets the correct Content-Type hint (critical for Safari/iOS MP4).
#   [WB-4]  Audio format validation extended: now accepts WebM, OGG, MP4, AAC, WAV.
#   [WB-5]  [FIX-15] resume_context passed ONCE to llm_service — NOT appended to
#           every user message turn. Resume is in system prompt only.
#   [WB-6]  [FIX-16] First-turn opener does NOT repeat resume context.
#   [WB-7]  TTS sender worker loop: audio sent in correct time order.
#           audio_queue.join() ensures all TTS tasks finish before response_complete.
#   [WB-8]  safe_send helper de-duplicated — defined once, used everywhere.
# ════════════════════════════════════════════════════════════════════════════════

import logging
import uuid
import base64
import asyncio
import re
import os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.llm_service import llm_service
from services.audio_service import AudioService
from db.redis_client import redis_cache
from db.supabase_client import get_supabase_service_client
from core.panel_config import PANEL_PROFILES, get_chairman_name, get_speaker_voices
from core.security import verify_token
from workers.analytics_worker import enqueue_analytics_generation

router = APIRouter(tags=["ws"])
logger = logging.getLogger("uvicorn")

MAX_HISTORY_TURNS   = 12
MAX_CHARS_PER_TURN  = 800
SILENCE_MIN_LENGTH  = 2
SPEAKER_TAG_PATTERN = re.compile(r'\[([A-Za-z][A-Za-z .]{1,24})\]')
PAUSE_PATTERN       = re.compile(r'(?<=[.?!])\s+(?=[A-Z])')
STAGE_DIR_PATTERN   = re.compile(r'\[.*?\]')
OVERLAP_SIZE        = 25


# ════════════════════════════════════════════════════════════════════════════════
# DB HELPERS
# ════════════════════════════════════════════════════════════════════════════════

async def db_get_session(client, session_id: str) -> dict | None:
    result = await asyncio.to_thread(
        lambda: client.table("interviews").select("*").eq("id", session_id).execute()
    )
    return result.data[0] if result.data else None


async def db_insert_message(client, session_id: str, role: str, content: str) -> None:
    await asyncio.to_thread(
        lambda: client.table("interview_messages").insert({
            "session_id": session_id,
            "role":       role,
            "content":    content,
        }).execute()
    )


async def db_get_messages(client, session_id: str) -> list[dict]:
    result = await asyncio.to_thread(
        lambda: client.table("interview_messages")
                       .select("*")
                       .eq("session_id", session_id)
                       .order("created_at")
                       .execute()
    )
    return result.data if result.data else []


# ════════════════════════════════════════════════════════════════════════════════
# HISTORY MANAGEMENT
# ════════════════════════════════════════════════════════════════════════════════

def _trim_message_content(content: str) -> str:
    return content[:MAX_CHARS_PER_TURN] if len(content) > MAX_CHARS_PER_TURN else content


def build_active_history(full_history: list[dict]) -> list[dict]:
    window = full_history[-MAX_HISTORY_TURNS:]
    return [
        {"role": m["role"], "content": _trim_message_content(m.get("content", ""))}
        for m in window
    ]


# ════════════════════════════════════════════════════════════════════════════════
# RESUME CONTEXT BUILDER
# [WB-5] Called ONCE per session — injected into system prompt via llm_service.
#        NEVER appended to individual user message turns.
# ════════════════════════════════════════════════════════════════════════════════

async def build_resume_context(session_id: str) -> str:
    resume_text = await redis_cache.get_resume_text(session_id)
    if not resume_text or not resume_text.strip():
        return ""

    trimmed     = resume_text[:3000].strip()
    last_period = max(trimmed.rfind('.'), trimmed.rfind('\n'))
    if last_period > 2000:
        trimmed = trimmed[:last_period + 1]

    return trimmed


# ════════════════════════════════════════════════════════════════════════════════
# TOKEN VERIFICATION
# [WB-1] Emergency bypass removed.
#        Set BYPASS_AUTH=true in .env ONLY for local development.
#        This variable must NEVER be set in production deployments.
# ════════════════════════════════════════════════════════════════════════════════

_BYPASS_AUTH = os.getenv("BYPASS_AUTH", "false").lower() == "true"
if _BYPASS_AUTH:
    logger.warning(
        "⚠️  BYPASS_AUTH=true — Token verification disabled. "
        "This must NEVER be used in production!"
    )


def _verify_ws_token(token: str | None) -> dict | None:
    """
    Verify JWT token. Returns payload dict on success, None on failure.

    BYPASS_AUTH=true: allowed only in development — returns a fixed guest payload.
    """
    if _BYPASS_AUTH:
        return {"sub": "00000000-0000-0000-0000-000000000000", "dev": True}

    if not token:
        logger.warning("⚠️ WS connection rejected: no token provided")
        return None

    try:
        return verify_token(token)
    except Exception as e:
        logger.warning("⚠️ WS connection rejected: invalid token — %s", e)
        return None


# ════════════════════════════════════════════════════════════════════════════════
# SILENCE NOTIFIER
# ════════════════════════════════════════════════════════════════════════════════

async def notify_silence(ws: WebSocket, chairman_name: str) -> None:
    try:
        await ws.send_json({
            "type":    "silence_detected",
            "message": f"[{chairman_name}] I didn't catch that. Please speak clearly.",
        })
    except Exception:
        pass


# ════════════════════════════════════════════════════════════════════════════════
# TTS HELPERS (CONCURRENT PIPELINE)
# ════════════════════════════════════════════════════════════════════════════════

async def fetch_tts_audio(
    sentence: str,
    voice_id: str,
    audio_service: AudioService,  # [WB-2] Shared instance passed in, not created here
) -> bytes | None:
    clean_text = STAGE_DIR_PATTERN.sub('', sentence).strip()
    if not clean_text:
        return None
    try:
        audio_bytes = bytearray()
        async for chunk in audio_service.tts_stream(clean_text, voice_id):
            if chunk:
                audio_bytes.extend(chunk)
        return bytes(audio_bytes) if audio_bytes else None
    except Exception as e:
        logger.error("❌ TTS fetch failed: %s", e)
        return None


async def tts_sender_worker(queue: asyncio.Queue, ws: WebSocket) -> None:
    """
    Consumes TTS futures from the queue and sends audio chunks to the client
    in order. Stops when it receives None (sentinel).
    """
    while True:
        task = await queue.get()
        if task is None:
            queue.task_done()
            break
        try:
            audio_bytes = await task
            if audio_bytes:
                try:
                    await ws.send_json({
                        "type":  "audio_chunk",
                        "audio": base64.b64encode(audio_bytes).decode(),
                    })
                except (RuntimeError, Exception) as e:
                    if "websocket.close" in str(e) or "already completed" in str(e):
                        break
                    logger.error("❌ TTS sender send error: %s", e)
                    break
        except Exception as e:
            logger.error("❌ TTS sender worker error: %s", e)
        finally:
            queue.task_done()


# ════════════════════════════════════════════════════════════════════════════════
# MAIN WEBSOCKET ENDPOINT
# ════════════════════════════════════════════════════════════════════════════════

@router.websocket("/ws/v1/interview/{session_id}")
async def interview_ws(ws: WebSocket, session_id: str, token: str = Query(None)):
    # ✅ SABSE PEHLE ACCEPT KARO
    await ws.accept()

    token_payload = _verify_ws_token(token)
    if token_payload is None:
        # ✅ AB ye 1008 cleanly frontend tak jayega aur redirect kaam karega
        await ws.close(code=1008, reason="Unauthorized")
        return

    user_id = token_payload.get("sub")
    audio_service = AudioService()

    try:
        logger.info("🚀 WS accepted: session=%s user=%s", session_id, user_id)
        # Baaki ka code waise hi rehne do...
        logger.info("🚀 WS accepted: session=%s user=%s", session_id, user_id)

        client = get_supabase_service_client()

        try:
            session_uuid = str(uuid.UUID(session_id))
        except ValueError:
            await ws.close(code=1008, reason="Invalid session ID")
            return

        session = await db_get_session(client, session_uuid)
        if not session:
            await ws.close(code=1008, reason="Session not found")
            return

        domain         = (session.get("domain") or "sde").lower()
        candidate_name = session.get("name") or "there"
        language       = session.get("language") or session.get("settings", {}).get("language", "English")
        target_year    = session.get("target_year") or session.get("settings", {}).get("targetYear", "")
        difficulty     = session.get("difficulty") or session.get("settings", {}).get("difficulty", "Moderate")
        focus_topics   = session.get("topic") or session.get("settings", {}).get("topic", "")

        candidate_info = {
            "name":        candidate_name,
            "language":    language,
            "target_year": target_year,
            "difficulty":  difficulty,
            "topic":       focus_topics,
        }

        chairman_name  = get_chairman_name(domain)
        speaker_voices = get_speaker_voices(domain)
        chairman_voice = speaker_voices[chairman_name]

        # [WB-5] Resume loaded once — injected into system prompt, never repeated
        resume_context = await build_resume_context(session_id)
        if resume_context:
            logger.info(
                "📄 Resume loaded: %d chars — injected in system prompt only",
                len(resume_context),
            )

        try:
            await ws.send_json({
                "type":           "session_info",
                "domain":         domain,
                "candidate_name": candidate_name,
                "language":       language,
                "chairman_name":  chairman_name,
            })
        except Exception:
            pass

        full_history = await redis_cache.get_session_context(session_id)
        if full_history is None:
            full_history = await db_get_messages(client, session_uuid)

        # ════════════════════════════════════════════════════════════════════
        # CORE: GENERATE + STREAM RESPONSE
        # ════════════════════════════════════════════════════════════════════

        async def generate_and_send_response(
            user_msg: str | None,
            history: list[dict],
            dom: str,
            is_first: bool = False,
        ) -> None:
            current_spk = chairman_name
            current_v   = chairman_voice

            audio_queue = asyncio.Queue()
            worker_task = asyncio.create_task(tts_sender_worker(audio_queue, ws))

            # [WB-8] safe_send defined once, used throughout
            async def safe_send(data: dict) -> bool:
                try:
                    await ws.send_json(data)
                    return True
                except RuntimeError as e:
                    if "websocket.close" in str(e) or "already completed" in str(e):
                        return False
                    raise
                except Exception:
                    return False

            try:
                if is_first:
                    # [WB-6] First-turn opener — resume is already in system prompt, not repeated here
                    domain_tone = {
                        "upsc": "formal, weighty, and dignified",
                        "sde":  "direct, technical, and no-nonsense",
                        "psu":  "professional, precise, and authoritative",
                    }.get(dom, "professional and direct")

                    user_content = (
                        f"The candidate has just entered and taken their seat. "
                        f"Open the interview immediately.\n"
                        f"STRICT RULES FOR THIS OPENER:\n"
                        f"  - NO weather, NO clock time, NO office/room descriptions\n"
                        f"  - NO stage directions like (smiling) or (nodding)\n"
                        f"  - NO 'Welcome to our office' or pleasantries\n"
                        f"  - Begin with [{chairman_name}] speaker tag — mandatory\n"
                        f"  - Maximum 18 words after the tag — count strictly\n"
                        f"  - Tone: {domain_tone}\n"
                        f"  - Close by asking them to introduce themselves\n"
                        f"CORRECT examples:\n"
                        f"  '[{chairman_name}] Let's begin. Please introduce yourself briefly.'\n"
                        f"  '[{chairman_name}] Good. Tell us about yourself in a few sentences.'"
                    )
                    structured_messages = [{"role": "user", "content": user_content}]

                else:
                    if not user_msg or len(user_msg.strip()) < SILENCE_MIN_LENGTH:
                        await notify_silence(ws, chairman_name)
                        worker_task.cancel()
                        return

                    active_history      = build_active_history(history)
                    structured_messages = list(active_history)
                    structured_messages.append({"role": "user", "content": user_msg})

                full_response   = ""
                sentence_buffer = ""
                carry_over      = ""

                if not await safe_send({"type": "thinking", "status": True}):
                    return

                # [WB-5] resume_context passed as dedicated param to llm_service
                async for chunk in llm_service.stream_response(
                    messages=structured_messages,
                    domain=dom,
                    candidate_info=candidate_info,
                    resume_context=resume_context,
                ):
                    full_response   += chunk
                    sentence_buffer += chunk

                    # Detect speaker changes for multi-panelist domains
                    window    = carry_over + chunk
                    tag_match = SPEAKER_TAG_PATTERN.search(window)
                    if tag_match:
                        new_spk = tag_match.group(1).strip()
                        if new_spk in speaker_voices and new_spk != current_spk:
                            current_spk = new_spk
                            current_v   = speaker_voices.get(current_spk, chairman_voice)
                            if not await safe_send({"type": "speaker_change", "speaker": current_spk}):
                                return
                    carry_over = window[-OVERLAP_SIZE:]

                    # Sentence-boundary TTS trigger
                    s_match = PAUSE_PATTERN.search(sentence_buffer)
                    if s_match:
                        sentence        = sentence_buffer[:s_match.start() + 1].strip()
                        sentence_buffer = sentence_buffer[s_match.end():]
                        if sentence:
                            # [WB-2] Pass shared audio_service instance
                            tts_task = asyncio.create_task(
                                fetch_tts_audio(sentence, current_v, audio_service)
                            )
                            await audio_queue.put(tts_task)

                    if not await safe_send({"type": "ai_text_chunk", "text": chunk}):
                        return

                # Flush remaining text (with or without terminal punctuation)
                remaining = sentence_buffer.strip()
                if remaining:
                    if remaining[-1] not in ".?!":
                        logger.debug("⚠️ Flushing unpunctuated sentence: %s", remaining[:60])
                    tts_task = asyncio.create_task(
                        fetch_tts_audio(remaining, current_v, audio_service)
                    )
                    await audio_queue.put(tts_task)

                # [WB-7] Sentinel tells worker to stop; join() ensures all audio is sent
                await audio_queue.put(None)
                await worker_task
                await audio_queue.join()

                await safe_send({"type": "response_complete", "text": full_response})
                await safe_send({"type": "thinking", "status": False})

                await db_insert_message(client, session_uuid, "assistant", full_response)
                history.append({"role": "assistant", "content": full_response})
                await redis_cache.set_session_context(session_id, build_active_history(history))

            except asyncio.CancelledError:
                if not worker_task.done():
                    worker_task.cancel()

            except Exception as e:
                if "websocket.close" in str(e) or "already completed" in str(e):
                    logger.info("🔌 Client disconnected mid-generation [%s]", session_id)
                else:
                    logger.error("❌ AI generation error [%s]: %s", session_id, e, exc_info=True)
                await safe_send({"type": "thinking", "status": False})
                if not worker_task.done():
                    worker_task.cancel()

        # ════════════════════════════════════════════════════════════════════
        # ENTRY POINT
        # ════════════════════════════════════════════════════════════════════

        current_ai_task: asyncio.Task | None = None

        if not full_history:
            current_ai_task = asyncio.create_task(
                generate_and_send_response(None, full_history, domain, is_first=True)
            )
        else:
            last_ai = next(
                (m for m in reversed(full_history) if m.get("role") == "assistant"),
                None,
            )
            if last_ai:
                try:
                    await ws.send_json({"type": "question", "text": last_ai["content"]})
                except Exception:
                    pass

        # ════════════════════════════════════════════════════════════════════
        # MAIN RECEIVE LOOP
        # ════════════════════════════════════════════════════════════════════

        # audio_buffer accumulates chunks between audio_chunk and speech_end events
        audio_buffer: list[bytes] = []
        # [WB-3] Track the MIME type hint from the most recent audio_chunk message
        last_mime_hint: str | None = None

        while True:
            try:
                data     = await ws.receive_json()
                msg_type = data.get("type")

                if msg_type == "audio_chunk":
                    raw_data = data.get("data", "")
                    if not raw_data:
                        logger.warning("⚠️ Empty audio_chunk data — skipped")
                        continue
                    try:
                        audio_buffer.append(base64.b64decode(raw_data))
                        # [WB-3] Save MIME hint for use in stt_stream()
                        last_mime_hint = data.get("mimeType") or None
                    except Exception:
                        logger.warning("⚠️ Malformed audio_chunk (base64 decode failed) — skipped")

                elif msg_type == "interrupt":
                    if current_ai_task and not current_ai_task.done():
                        current_ai_task.cancel()
                    try:
                        await ws.send_json({"type": "thinking", "status": False})
                    except Exception:
                        pass

                elif msg_type == "text":
                    # Text-mode input (no audio)
                    u_input = data.get("text", "").strip()
                    if not u_input or len(u_input) < SILENCE_MIN_LENGTH:
                        await notify_silence(ws, chairman_name)
                        continue

                    try:
                        await ws.send_json({"type": "transcription", "text": u_input})
                    except Exception:
                        pass

                    await db_insert_message(client, session_uuid, "user", u_input)
                    full_history.append({"role": "user", "content": u_input})

                    if current_ai_task and not current_ai_task.done():
                        current_ai_task.cancel()
                    current_ai_task = asyncio.create_task(
                        generate_and_send_response(u_input, full_history, domain)
                    )

                elif msg_type == "speech_end":
                    # Audio speech turn complete — run STT
                    raw_audio    = b"".join(audio_buffer)
                    audio_buffer = []

                    if not raw_audio or len(raw_audio) < 100:
                        await notify_silence(ws, chairman_name)
                        last_mime_hint = None
                        continue

                    # [WB-4] Extended format check for logging/debugging
                    magic4 = raw_audio[:4]
                    magic8 = raw_audio[4:8]
                    is_webm = magic4 == b'\x1a\x45\xdf\xa3'
                    is_ogg  = magic4 == b'OggS'
                    is_mp4  = magic8 == b'ftyp'
                    is_aac  = magic4[:2] in (b'\xff\xf1', b'\xff\xf9')
                    is_wav  = magic4 == b'RIFF'

                    if not any([is_webm, is_ogg, is_mp4, is_aac, is_wav]):
                        logger.warning(
                            "⚠️ Unrecognised audio format (magic bytes: %s, hint: %s)",
                            raw_audio[:8].hex(), last_mime_hint,
                        )

                    # [WB-3] Pass MIME hint so audio_service can use it as fallback
                    u_input = await audio_service.stt_stream(
                        raw_audio,
                        mime_hint=last_mime_hint,
                    )
                    last_mime_hint = None  # reset after use

                    if not u_input or len(u_input.strip()) < SILENCE_MIN_LENGTH:
                        await notify_silence(ws, chairman_name)
                        continue

                    try:
                        await ws.send_json({"type": "transcription", "text": u_input})
                    except Exception:
                        pass

                    await db_insert_message(client, session_uuid, "user", u_input)
                    full_history.append({"role": "user", "content": u_input})

                    if current_ai_task and not current_ai_task.done():
                        current_ai_task.cancel()
                    current_ai_task = asyncio.create_task(
                        generate_and_send_response(u_input, full_history, domain)
                    )

                elif msg_type == "telemetry":
                    asyncio.create_task(redis_cache.store_telemetry(session_id, data))

            except WebSocketDisconnect:
                logger.info("🔌 Client disconnected: %s", session_id)
                break

            except RuntimeError as e:
                if "websocket.close" in str(e) or "already completed" in str(e):
                    logger.info("🔌 Client disconnected abruptly: %s", session_id)
                else:
                    logger.error("❌ WS receive error [%s]: %s", session_id, e, exc_info=True)
                break

            except Exception as e:
                logger.error("❌ WS receive error [%s]: %s", session_id, e, exc_info=True)
                break

    except Exception as e:
        logger.error("❌ Fatal WS error [%s]: %s", session_id, e, exc_info=True)

    finally:
        try:
            await enqueue_analytics_generation(session_id)
        except Exception as e:
            logger.error("❌ Analytics enqueue failed [%s]: %s", session_id, e)