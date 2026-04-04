# services/audio_service.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION FIXES:
#   [AS-1]  Removed hardcoded Content-Type: audio/webm.
#           Now detects format from magic bytes (WebM, OGG, MP4/AAC, WAV).
#           Safari/iOS sends audio/mp4 — this was causing Deepgram to reject it.
#   [AS-2]  Accepts optional mime_type hint from frontend (sent by useAudioRecorder).
#           Magic-byte detection takes priority; mime_type hint is a fallback.
#   [AS-3]  Added filler_words=true so "umm", "uhh" appear in transcripts.
#           Useful for candidate confidence analysis in interview platform.
#   [AS-4]  TTS sentence accumulation unchanged — entire sentence yielded at once
#           to prevent browser MP3 frame splits causing "cut-cut" audio.
#   [AS-5]  Improved logging: log detected format and audio size for debugging.
#   [AS-6]  Added multichannel=false explicitly — Deepgram default is true but
#           we're sending mono audio; disabling avoids empty channel results.
# ════════════════════════════════════════════════════════════════════════════════

from __future__ import annotations
import httpx
import logging
import edge_tts
from core.config import settings

logger = logging.getLogger("uvicorn")

# ── Voice map: ElevenLabs voice_id → Edge TTS voice name ─────────────────────
_EDGE_VOICE_MAP: dict[str, str] = {
    "pNInz6obpgDQGcFmaJgB": "en-IN-PrabhatNeural",      # Adam    → Prabhat (deep)
    "VR6AaFsHqHg7MvM":      "en-US-ChristopherNeural",   # Arnold  → Christopher
    "ErXw93pU699Pshq97A0f": "en-GB-RyanNeural",           # Antoni  → Ryan
    "GBv7mTt0atIp3Br8iCZE": "en-US-GuyNeural",            # Thomas  → Guy
    "oWAxZDx7w5VEj9dCyTzz": "en-IN-NeerjaNeural",         # Grace   → Neerja (female)
    "Xb7hHqWq7++bSpIByZpB": "en-US-JennyNeural",
    "EXAVITQu4vr4xnSDxMaL": "en-US-JennyNeural",
    "pFZP5JQG7iQjI5tjgnnu": "en-US-JennyNeural",
}
_DEFAULT_VOICE = "en-IN-PrabhatNeural"


# ── [AS-1] Magic-byte based audio format detection ───────────────────────────

def _detect_content_type(audio_data: bytes, mime_hint: str | None = None) -> str:
    """
    Detect audio MIME type from the first bytes of the file.

    Magic bytes reference:
        WebM  : 0x1A 0x45 0xDF 0xA3  (EBML header)
        OGG   : 0x4F 0x67 0x67 0x53  ("OggS")
        MP4   : bytes[4:8] == b"ftyp" (ISO Base Media File Format)
        AAC   : 0xFF 0xF1 or 0xFF 0xF9 (ADTS frame sync)
        WAV   : 0x52 0x49 0x46 0x46  ("RIFF")

    Falls back to mime_hint from the frontend, then to audio/webm.
    """
    if len(audio_data) < 8:
        return mime_hint or "audio/webm"

    magic4 = audio_data[:4]
    magic8 = audio_data[4:8]

    if magic4 == b'\x1a\x45\xdf\xa3':
        return "audio/webm"

    if magic4 == b'OggS':
        return "audio/ogg"

    if magic8 == b'ftyp':
        return "audio/mp4"

    if magic4[:2] in (b'\xff\xf1', b'\xff\xf9'):
        return "audio/aac"

    if magic4 == b'RIFF':
        return "audio/wav"

    # [AS-2] Fall back to hint sent by the frontend (set by getSupportedMimeType())
    if mime_hint and mime_hint.startswith("audio/"):
        return mime_hint

    return "audio/webm"


# ── Service ───────────────────────────────────────────────────────────────────

class AudioService:

    def __init__(self):
        self.deepgram_api_key = settings.deepgram_api_key

    # ── SPEECH-TO-TEXT ────────────────────────────────────────────────────────

    async def stt_stream(
        self,
        audio_data: bytes,
        mime_hint: str | None = None,
    ) -> str:
        """
        Transcribe audio via Deepgram Nova-2.

        Args:
            audio_data: Raw audio bytes (WebM, OGG, MP4, AAC, or WAV).
            mime_hint:  Optional MIME type from the frontend (useAudioRecorder
                        sends mimeType with every audio_chunk). Used as fallback
                        if magic bytes are ambiguous.

        Returns:
            Transcribed text string, or "" on any failure.
        """
        if not audio_data or len(audio_data) < 100:
            return ""

        if not self.deepgram_api_key:
            logger.error("❌ Deepgram API key not set")
            return ""

        # [AS-1] Detect format — never hardcode audio/webm
        content_type = _detect_content_type(audio_data, mime_hint)

        # [AS-5] Debug log to confirm correct format is sent
        logger.debug(
            "🎤 STT: %d bytes, detected content_type=%s (hint=%s)",
            len(audio_data), content_type, mime_hint,
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "https://api.deepgram.com/v1/listen",
                    headers={
                        "Authorization": f"Token {self.deepgram_api_key}",
                        "Content-Type":  content_type,  # [AS-1] Dynamic, not hardcoded
                    },
                    params={
                        "model":        "nova-2",
                        "smart_format": "true",
                        "language":     "en-IN",
                        "punctuate":    "true",
                        "filler_words": "true",    # [AS-3] Capture "umm", "uhh" etc.
                        "multichannel": "false",   # [AS-6] We send mono; avoid empty results
                    },
                    content=audio_data,
                )
                response.raise_for_status()
                data       = response.json()
                transcript = (
                    data.get("results", {})
                        .get("channels", [{}])[0]
                        .get("alternatives", [{}])[0]
                        .get("transcript", "")
                )
                result = transcript.strip()
                logger.debug("✅ STT result (%d chars): %s…", len(result), result[:60])
                return result

        except httpx.HTTPStatusError as e:
            logger.error(
                "❌ Deepgram HTTP %s: %s",
                e.response.status_code,
                e.response.text[:300],
            )
            return ""
        except Exception as e:
            logger.error("❌ STT failed: %s", e)
            return ""

    # ── TEXT-TO-SPEECH ────────────────────────────────────────────────────────

    async def tts_stream(self, text: str, voice_id: str):
        """
        Generate TTS audio and yield the COMPLETE sentence as one chunk.

        [AS-4] WHY WE BUFFER:
        MP3 is a framed format. If a frame is split across two WebSocket messages,
        the browser's AudioContext.decodeAudioData() sees an invalid frame boundary
        and either throws or produces a "click/cut" artifact.

        By accumulating the ENTIRE sentence before yielding, we guarantee the
        browser receives a complete, self-contained MP3 every time.
        """
        if not text or not text.strip():
            return

        edge_voice = _EDGE_VOICE_MAP.get(voice_id, _DEFAULT_VOICE)
        clean_text = text.strip()

        logger.debug("🎙️ TTS start: voice=%s len=%d text='%s'", edge_voice, len(clean_text), clean_text[:50])

        try:
            communicate  = edge_tts.Communicate(clean_text, edge_voice, rate="+5%")
            audio_buffer = bytearray()  # bytearray is faster than bytes + for repeated extend()

            async for chunk in communicate.stream():
                if chunk["type"] == "audio" and chunk.get("data"):
                    audio_buffer.extend(chunk["data"])

            if audio_buffer:
                logger.debug("✅ TTS done: %d bytes", len(audio_buffer))
                yield bytes(audio_buffer)
            else:
                logger.warning("⚠️ TTS returned 0 bytes for text: '%s'", clean_text[:60])

        except Exception as e:
            logger.error("❌ Edge TTS failed [voice=%s]: %s", edge_voice, e)
            # Yield nothing — WS handler skips the sentence gracefully