# api/v1/websockets.py — FINAL v3.0
# ════════════════════════════════════════════════════════════════════════════════
# FIXES:
#   [WB-1]  voice_change handler — cycles to next panel speaker, sends confirmation
#   [WB-2]  [System] messages — NOT saved to DB, NOT added to history
#           (silence reminders are ephemeral — keeps history clean)
#   [WB-3]  generate_and_send_response gets is_system flag — skips DB save
#   [WB-4]  response_complete sent AFTER audio queue drains (no early trigger)
#   [WB-5]  MIN_TTS_CHARS = 4 — avoids TTS pops on tiny fragments
# ════════════════════════════════════════════════════════════════════════════════

import logging
import uuid
import base64
import asyncio
import re
import os
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.llm_service   import llm_service
from services.audio_service import AudioService
from db.redis_client        import redis_cache
from db.supabase_client     import get_supabase_service_client
from core.panel_config      import PANEL_PROFILES, get_chairman_name, get_speaker_voices
from core.security          import verify_token
from workers.analytics_worker import enqueue_analytics_generation

router = APIRouter(tags=["ws"])
logger = logging.getLogger("uvicorn")

MAX_HISTORY_TURNS   = 12
MAX_CHARS_PER_TURN  = 800
SILENCE_MIN_LENGTH  = 2
MIN_TTS_CHARS       = 4          # [WB-5] skip tiny TTS fragments
SPEAKER_TAG_PATTERN = re.compile(r'\[([A-Za-z][A-Za-z .]{1,24})\]')
PAUSE_PATTERN       = re.compile(r'(?<=[.?!])\s+(?=[A-Z])')
STAGE_DIR_PATTERN   = re.compile(r'\[.*?\]')
SYSTEM_MSG_PATTERN  = re.compile(r'^\[System\]', re.IGNORECASE)
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

def _trim(content: str) -> str:
    return content[:MAX_CHARS_PER_TURN] if len(content) > MAX_CHARS_PER_TURN else content


def build_active_history(full_history: list[dict]) -> list[dict]:
    return [
        {"role": m["role"], "content": _trim(m.get("content", ""))}
        for m in full_history[-MAX_HISTORY_TURNS:]
    ]


# ════════════════════════════════════════════════════════════════════════════════
# RESUME CONTEXT
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
# ════════════════════════════════════════════════════════════════════════════════

_BYPASS_AUTH = os.getenv("BYPASS_AUTH", "false").lower() == "true"
if _BYPASS_AUTH:
    logger.warning("⚠️  BYPASS_AUTH=true — NEVER use in production!")


def _verify_ws_token(token: str | None) -> dict | None:
    if _BYPASS_AUTH:
        return {"sub": "00000000-0000-0000-0000-000000000000", "dev": True}
    if not token:
        return None
    try:
        return verify_token(token)
    except Exception as e:
        logger.warning("⚠️ WS rejected: %s", e)
        return None


# ════════════════════════════════════════════════════════════════════════════════
# SILENCE NOTIFIER
# ════════════════════════════════════════════════════════════════════════════════

async def notify_silence(ws: WebSocket, chairman_name: str) -> None:
    try:
        await ws.send_json({
            "type":    "silence_detected",
            "message": f"[{chairman_name}] Please speak clearly. We didn't catch that.",
        })
    except Exception:
        pass


# ════════════════════════════════════════════════════════════════════════════════
# TTS HELPERS
# ════════════════════════════════════════════════════════════════════════════════

async def fetch_tts_audio(
    sentence:      str,
    voice_id:      str,
    rate:          str,
    audio_service: AudioService,
) -> bytes | None:
    clean_text = STAGE_DIR_PATTERN.sub('', sentence).strip()
    if not clean_text or len(clean_text) < MIN_TTS_CHARS:  # [WB-5]
        return None
    try:
        audio_bytes = bytearray()
        async for chunk in audio_service.tts_stream(clean_text, voice_id, rate):
            if chunk:
                audio_bytes.extend(chunk)
        return bytes(audio_bytes) if audio_bytes else None
    except Exception as e:
        logger.error("❌ TTS fetch failed: %s", e)
        return None


async def tts_sender_worker(queue: asyncio.Queue, ws: WebSocket) -> None:
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
                    logger.error("❌ TTS sender error: %s", e)
                    break
        except Exception as e:
            logger.error("❌ TTS worker error: %s", e)
        finally:
            queue.task_done()


# ════════════════════════════════════════════════════════════════════════════════
# MAIN WEBSOCKET ENDPOINT
# ════════════════════════════════════════════════════════════════════════════════

@router.websocket("/ws/v1/interview/{session_id}")
async def interview_ws(ws: WebSocket, session_id: str, token: str = Query(None)):

    await ws.accept()

    token_payload = _verify_ws_token(token)
    if token_payload is None:
        await ws.close(code=1008, reason="Unauthorized")
        return

    user_id       = token_payload.get("sub")
    audio_service = AudioService()

    try:
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

        # [WB-1] speaker_voices — mutable list for voice cycling
        speaker_voices = get_speaker_voices(domain)
        all_speakers   = list(speaker_voices.keys())

        # Current "active" speaker index (starts at chairman = index 0)
        active_speaker_idx  = 0
        chairman_name       = all_speakers[0]
        chairman_voice, chairman_rate = speaker_voices[chairman_name]

        resume_context = await build_resume_context(session_id)
        if resume_context:
            logger.info("📄 Resume: %d chars", len(resume_context))

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
            user_msg:  str | None,
            history:   list[dict],
            dom:       str,
            is_first:  bool = False,
            is_system: bool = False,  # [WB-2] silence reminders
        ) -> None:
            # Always start from the currently active speaker
            current_spk  = all_speakers[active_speaker_idx]
            current_v, current_r = speaker_voices[current_spk]

            audio_queue = asyncio.Queue()
            worker_task = asyncio.create_task(tts_sender_worker(audio_queue, ws))

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
                    domain_tone = {
                        "upsc": "formal, weighty, and dignified",
                        "sde":  "direct, technical, and no-nonsense",
                        "psu":  "professional, precise, and authoritative",
                    }.get(dom, "professional and direct")

                    ch = all_speakers[active_speaker_idx]
                    user_content = (
                        f"The candidate has just entered. Open the interview immediately.\n"
                        f"STRICT RULES:\n"
                        f"  - NO weather, NO clock, NO office descriptions\n"
                        f"  - NO stage directions like (smiling)\n"
                        f"  - Begin with [{ch}] speaker tag — mandatory\n"
                        f"  - Maximum 18 words after tag — count strictly\n"
                        f"  - Tone: {domain_tone}\n"
                        f"  - End by asking to introduce themselves\n"
                        f"EXAMPLES:\n"
                        f"  '[{ch}] Let's begin. Please introduce yourself briefly.'\n"
                        f"  '[{ch}] Good. Tell us about yourself in a few sentences.'"
                    )
                    structured_messages = [{"role": "user", "content": user_content}]

                else:
                    if not user_msg or len(user_msg.strip()) < SILENCE_MIN_LENGTH:
                        await notify_silence(ws, all_speakers[active_speaker_idx])
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

                async for chunk in llm_service.stream_response(
                    messages=structured_messages,
                    domain=dom,
                    candidate_info=candidate_info,
                    resume_context=resume_context,
                ):
                    full_response   += chunk
                    sentence_buffer += chunk

                    window    = carry_over + chunk
                    tag_match = SPEAKER_TAG_PATTERN.search(window)
                    if tag_match:
                        new_spk = tag_match.group(1).strip()
                        if new_spk in speaker_voices and new_spk != current_spk:
                            current_spk          = new_spk
                            current_v, current_r = speaker_voices.get(
                                current_spk, (chairman_voice, chairman_rate)
                            )
                            if not await safe_send({"type": "speaker_change", "speaker": current_spk}):
                                return
                    carry_over = window[-OVERLAP_SIZE:]

                    s_match = PAUSE_PATTERN.search(sentence_buffer)
                    if s_match:
                        sentence        = sentence_buffer[:s_match.start() + 1].strip()
                        sentence_buffer = sentence_buffer[s_match.end():]
                        if sentence and len(sentence) >= MIN_TTS_CHARS:
                            tts_task = asyncio.create_task(
                                fetch_tts_audio(sentence, current_v, current_r, audio_service)
                            )
                            await audio_queue.put(tts_task)

                    if not await safe_send({"type": "ai_text_chunk", "text": chunk}):
                        return

                remaining = sentence_buffer.strip()
                if remaining and len(remaining) >= MIN_TTS_CHARS:
                    tts_task = asyncio.create_task(
                        fetch_tts_audio(remaining, current_v, current_r, audio_service)
                    )
                    await audio_queue.put(tts_task)

                await audio_queue.put(None)
                await worker_task
                await audio_queue.join()  # [WB-4] wait for audio to drain first

                await safe_send({"type": "response_complete", "text": full_response})
                await safe_send({"type": "thinking", "status": False})

                # [WB-2] Only save real responses to DB (not silence reminder replies)
                if not is_system:
                    await db_insert_message(client, session_uuid, "assistant", full_response)
                    history.append({"role": "assistant", "content": full_response})
                    await redis_cache.set_session_context(session_id, build_active_history(history))

            except asyncio.CancelledError:
                if not worker_task.done():
                    worker_task.cancel()

            except Exception as e:
                if "websocket.close" in str(e) or "already completed" in str(e):
                    logger.info("🔌 Disconnected mid-generation [%s]", session_id)
                else:
                    logger.error("❌ AI error [%s]: %s", session_id, e, exc_info=True)
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

        while True:
            try:
                data     = await ws.receive_json()
                msg_type = data.get("type")

                if msg_type == "text":
                    u_input = data.get("text", "").strip()
                    if not u_input or len(u_input) < SILENCE_MIN_LENGTH:
                        await notify_silence(ws, all_speakers[active_speaker_idx])
                        continue

                    # [WB-2] Detect silence reminder — don't save to DB or history
                    is_system = bool(SYSTEM_MSG_PATTERN.match(u_input))

                    try:
                        # Don't echo system messages to captions
                        if not is_system:
                            await ws.send_json({"type": "transcription", "text": u_input})
                    except Exception:
                        pass

                    if not is_system:
                        await db_insert_message(client, session_uuid, "user", u_input)
                        full_history.append({"role": "user", "content": u_input})
                    # System messages go to LLM for AI to respond but DON'T pollute history
                    # We pass the full history (without adding system msg) so AI has context

                    if current_ai_task and not current_ai_task.done():
                        current_ai_task.cancel()

                    current_ai_task = asyncio.create_task(
                        generate_and_send_response(
                            u_input, full_history, domain,
                            is_system=is_system,  # [WB-3]
                        )
                    )

                elif msg_type == "interrupt":
                    if current_ai_task and not current_ai_task.done():
                        current_ai_task.cancel()
                    try:
                        await ws.send_json({"type": "thinking", "status": False})
                    except Exception:
                        pass

                elif msg_type == "voice_change":
                    # [WB-1] Cycle to next panel member
                    active_speaker_idx = (active_speaker_idx + 1) % len(all_speakers)
                    next_speaker       = all_speakers[active_speaker_idx]
                    chairman_voice, chairman_rate = speaker_voices[next_speaker]
                    logger.info("🎭 Voice switched to: %s", next_speaker)
                    try:
                        await ws.send_json({
                            "type":  "voice_changed",
                            "voice": next_speaker,
                        })
                    except Exception:
                        pass

                elif msg_type == "telemetry":
                    asyncio.create_task(redis_cache.store_telemetry(session_id, data))

            except WebSocketDisconnect:
                logger.info("🔌 Disconnected: %s", session_id)
                break

            except RuntimeError as e:
                if "websocket.close" in str(e) or "already completed" in str(e):
                    logger.info("🔌 Abrupt disconnect: %s", session_id)
                else:
                    logger.error("❌ WS error [%s]: %s", session_id, e, exc_info=True)
                break

            except Exception as e:
                logger.error("❌ WS error [%s]: %s", session_id, e, exc_info=True)
                break

    except Exception as e:
        logger.error("❌ Fatal WS error [%s]: %s", session_id, e, exc_info=True)

    finally:
        try:
            await enqueue_analytics_generation(session_id)
        except Exception as e:
            logger.error("❌ Analytics enqueue failed [%s]: %s", session_id, e)