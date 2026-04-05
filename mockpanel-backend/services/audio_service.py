# services/audio_service.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION v3.0 — PURE EDGE TTS (Female Primary -> Male Fallback)
#
# CHANGES:
#   [AS-NEW-1] ElevenLabs COMPLETELY REMOVED. 100% free, fast, and no API limits.
#   [AS-NEW-2] Female-to-Male Fallback: If the requested female voice fails,
#              it instantly retries with a clear Male Indian voice (PrabhatNeural).
#   [AS-NEW-3] Cleaned up all old HTTPX and ElevenLabs logic for a lighter backend.
# ════════════════════════════════════════════════════════════════════════════════

from __future__ import annotations
import logging
import edge_tts
import re

logger = logging.getLogger("uvicorn")

# ── Fallback Config ────────────────────────────────────────────────────────────
# Default fallback voice — Indian female, warm and clear
_DEFAULT_EDGE_VOICE = "en-IN-NeerjaNeural"
# Fallback Male Voice (Agar female voice me koi network/API error aaye)
_FALLBACK_MALE_VOICE = "en-IN-PrabhatNeural"
_DEFAULT_RATE        = "-5%"   # Slightly slower than normal for natural interview feel

# Stage direction pattern (remove [smiling] etc from TTS input)
_STAGE_DIR_PATTERN = re.compile(r'\[.*?\]')


def _resolve_edge_voice(voice_identifier: str) -> str:
    """
    Resolve a voice identifier to an Edge TTS voice name.
    If the panel config sends an old ElevenLabs ID by mistake, it forces the default Female voice.
    """
    if "Neural" in voice_identifier or voice_identifier.startswith("en-"):
        return voice_identifier

    logger.warning(
        "⚠️ Unknown voice identifier '%s' — forcing default female voice: %s",
        voice_identifier, _DEFAULT_EDGE_VOICE,
    )
    return _DEFAULT_EDGE_VOICE


# ── Service ───────────────────────────────────────────────────────────────────

class AudioService:

    def __init__(self):
        logger.info("✅ Edge TTS initialized as the sole, lightning-fast audio engine")

    # ── TEXT-TO-SPEECH ────────────────────────────────────────────────────────

    async def tts_stream(
        self,
        text:    str,
        voice_identifier: str,
        rate:    str = _DEFAULT_RATE,
    ):
        """
        Generate TTS audio for a sentence using Edge TTS.
        If the primary voice fails, automatically fall back to a male voice.
        """
        if not text or not text.strip():
            return

        # Clean stage directions from TTS input
        clean_text = _STAGE_DIR_PATTERN.sub('', text).strip()
        if not clean_text:
            return

        edge_voice = _resolve_edge_voice(voice_identifier)

        try:
            # First attempt: Primary Voice (Mostly Female)
            async for chunk in self._stream_edge(clean_text, edge_voice, rate):
                yield chunk
                
        except Exception as e:
            logger.warning("⚠️ Primary voice (%s) failed: %s. Switching to Male Fallback!", edge_voice, e)
            try:
                # Second attempt: Fallback to clear Indian Male voice
                async for chunk in self._stream_edge(clean_text, _FALLBACK_MALE_VOICE, rate):
                    yield chunk
            except Exception as fallback_err:
                logger.error("❌ Both Primary and Fallback TTS failed: %s", fallback_err)


    async def _stream_edge(
        self,
        text:       str,
        edge_voice: str,
        rate:       str,
    ):
        """
        Core Edge TTS streaming logic. Buffers the entire sentence before yielding 
        (prevents MP3 frame splits which cause audio clicks in browser).
        """
        logger.debug(
            "🎙️ TTS [Edge]: voice=%s rate=%s len=%d text='%s...'",
            edge_voice, rate, len(text), text[:40],
        )

        try:
            communicate   = edge_tts.Communicate(text, edge_voice, rate=rate)
            audio_buffer  = bytearray()

            async for chunk in communicate.stream():
                if chunk["type"] == "audio" and chunk.get("data"):
                    audio_buffer.extend(chunk["data"])

            if audio_buffer:
                logger.debug("✅ Edge TTS done: %d bytes", len(audio_buffer))
                yield bytes(audio_buffer)
            else:
                raise ValueError("Edge TTS returned 0 bytes")

        except Exception as e:
            # Raise to trigger the fallback logic in `tts_stream`
            raise e