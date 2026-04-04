# services/llm_service.py
# ════════════════════════════════════════════════════════════════════════════════
# PRODUCTION-READY v3.0 — 6-MODEL WATERFALL FALLBACK
#
# FALLBACK ORDER:
#   1. Groq         — llama-3.1-8b-instant          (fastest, primary)
#   2. OpenRouter   — nvidia/nemotron-super:free      (OR model 1)
#   3. OpenRouter   — google/gemini-flash-lite:free   (OR model 2)
#   4. OpenRouter   — meta-llama/llama-3.2-3b:free    (OR model 3)
#   5. OpenRouter   — minimax/minimax-m2.5:free       (OR model 4)
#   6. Gemini       — gemini-2.5-flash               (absolute fallback)
#
# FIXES:
#   [FIX-15] Resume context injected ONCE in system prompt only.
#            Removed per-turn resume suffix (was inflating context 12x).
#   [FIX-16] First-turn opener no longer re-attaches resume.
#   [FIX-18] Gemini uses system_instruction param (not user content).
#   [FIX-OR] OpenRouter iterates through OR_MODELS array — if one model
#            returns 429/503, tries next automatically. No manual changes needed.
# ════════════════════════════════════════════════════════════════════════════════

from __future__ import annotations
import logging

from google import genai
from google.genai import types
from groq import AsyncGroq
from openai import AsyncOpenAI

from core.config import settings
from core.panel_config import PANEL_PROFILES

logger = logging.getLogger("uvicorn")

# ── Model constants ────────────────────────────────────────────────────────────
GROQ_MODEL   = "llama-3.1-8b-instant"
GEMINI_MODEL = "gemini-2.5-flash"

# [FIX-OR] Ordered fallback list — tried top-to-bottom on any OR failure.
# Add new free models at the TOP to prefer them first.
OR_MODELS = [
    "meta-llama/llama-3.2-3b-instruct:free",         # Llama 3.2 (Fast & Reliable)
    "google/gemini-2.0-flash-lite-preview-02-05:free", # Gemini Flash Lite
    "qwen/qwen-2-7b-instruct:free",                  # Strong backup
    "openrouter/free"                                # Auto-fallback
]
TEMPERATURE = 0.72
MAX_TOKENS  = 512


class LLMService:

    def __init__(self):
        # ── Groq (Primary) ─────────────────────────────────────────────────────
        self.groq_available = False
        if getattr(settings, "groq_api_key", None):
            self.groq_client    = AsyncGroq(api_key=settings.groq_api_key)
            self.groq_available = True
            logger.info("✅ Groq %s — ready (Primary)", GROQ_MODEL)

        # ── OpenRouter (Secondary — 5-model array) ─────────────────────────────
        self.or_available = False
        if getattr(settings, "openrouter_api_key", None):
            self.or_client = AsyncOpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=settings.openrouter_api_key,
            )
            self.or_available = True
            logger.info(
                "✅ OpenRouter — ready (Secondary, %d-model fallback array)",
                len(OR_MODELS),
            )

        # ── Gemini (Absolute fallback) ──────────────────────────────────────────
        self.gemini_available = False
        if getattr(settings, "gemini_api_key", None):
            self.gemini_client    = genai.Client(api_key=settings.gemini_api_key)
            self.gemini_available = True
            logger.info("✅ Gemini %s — ready (Fallback)", GEMINI_MODEL)

    # ════════════════════════════════════════════════════════════════════════════
    # SYSTEM PROMPT BUILDER
    # [FIX-15] resume_context embedded ONCE here — never in per-turn messages
    # ════════════════════════════════════════════════════════════════════════════
    def _build_system_prompt(
        self,
        domain: str,
        candidate_info: dict | None = None,
        resume_context: str = "",
    ) -> str:
        if candidate_info is None:
            candidate_info = {}

        if domain not in PANEL_PROFILES:
            logger.warning("⚠️ Unknown domain '%s' — defaulting to SDE", domain)
            domain = "sde"

        domain_system = PANEL_PROFILES[domain].get("system_prompt", "")
        raw_name      = candidate_info.get("name", "").strip()
        language      = (candidate_info.get("language") or "English").strip()
        target_year   = candidate_info.get("target_year", "the upcoming cycle")
        difficulty    = candidate_info.get("difficulty", "Moderate")
        focus_topics  = candidate_info.get("topic", "").strip()

        language_rules = {
            "English":  "LANGUAGE: 100% formal English only. Zero Hindi or regional words. No filler phrases.",
            "Hinglish": "LANGUAGE: Natural urban Indian code-switching. Mix English and Hindi the way educated Indian professionals speak. Let it emerge organically.",
            "Hindi":    "LANGUAGE: Formal Shuddh Hindi throughout. Administrative/sarkari register.",
        }
        lang_instruction = language_rules.get(language, language_rules["English"])

        difficulty_instruction = {
            "Easy":     "DIFFICULTY: Be encouraging. Allow the candidate to warm up. Gentler follow-ups.",
            "Moderate": "DIFFICULTY: Standard board-level pressure. Professional, firm, fair.",
            "Hard":     "DIFFICULTY: Maximum pressure. Do not let vague answers pass. Press until precise.",
        }.get(difficulty, "DIFFICULTY: Standard board-level pressure.")

        topic_instruction = ""
        if focus_topics:
            topic_instruction = (
                f"FOCUS TOPICS: The candidate selected: '{focus_topics}'.\n"
                f"Heavily bias your technical/core questions towards these topics.\n\n"
            )

        # [FIX-15] Resume block — injected ONCE at system level
        resume_block = ""
        if resume_context and resume_context.strip():
            resume_block = (
                "\n\n════════════════════════════════════════════════════════════════\n"
                "CANDIDATE RESUME / DAF — use this to personalise questions\n"
                "════════════════════════════════════════════════════════════════\n"
                f"{resume_context.strip()}\n"
                "════════════════════════════════════════════════════════════════\n"
                "INSTRUCTIONS: Mine for hometown, education, work, hobbies, achievements.\n"
                "Reference naturally. NEVER acknowledge you have seen a resume.\n"
                "NEVER invent details not present in this text.\n"
            )

        runtime_context = (
            "\n\n════════════════════════════════════════════════════════════════\n"
            "LIVE SESSION CONTEXT\n"
            "════════════════════════════════════════════════════════════════\n"
            f"Candidate Name  : {raw_name if raw_name else 'Not yet introduced'}\n"
            f"Target Cycle    : {target_year}\n"
            f"Session Language: {language}\n"
            f"Chosen Topics   : {focus_topics if focus_topics else 'General Domain Knowledge'}\n\n"
            f"{lang_instruction}\n\n"
            f"{difficulty_instruction}\n\n"
            f"{topic_instruction}"
            "NAME RULE:\n"
            "- If candidate says 'I am [Name]' or 'My name is [Name]' → use it naturally once or twice.\n"
            "- If name unknown → address them as 'you' directly.\n"
            "- NEVER use 'the candidate', 'the aspirant', 'the applicant', or 'the user'.\n\n"
            "🚨 ANTI-HALLUCINATION RULE:\n"
            "- NEVER invent background details (hometown, college, companies like 'Infosys').\n"
            "- ONLY use facts explicitly provided in LIVE SESSION CONTEXT or RESUME above.\n"
            "- If no resume is provided, ask generic domain questions or ask them to introduce themselves.\n"
            "════════════════════════════════════════════════════════════════\n"
        )

        # Final order: domain persona → resume (once) → runtime context
        return domain_system + resume_block + runtime_context

    # ════════════════════════════════════════════════════════════════════════════
    # GEMINI CONTENT BUILDER
    # [FIX-18] System prompt goes via system_instruction, NOT user content
    # ════════════════════════════════════════════════════════════════════════════
    def _build_gemini_contents(self, messages: list[dict]) -> list:
        contents = []
        for msg in messages:
            role    = "model" if msg["role"] == "assistant" else "user"
            content = msg.get("content", "")
            contents.append(types.Content(
                role=role,
                parts=[types.Part(text=content)],
            ))
        return contents

    # ════════════════════════════════════════════════════════════════════════════
    # STREAMING BACKENDS
    # ════════════════════════════════════════════════════════════════════════════

    async def _stream_groq(self, system_prompt: str, messages: list[dict]):
        stream = await self.groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "system", "content": system_prompt}, *messages],
            stream=True,
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def _stream_openrouter(
        self,
        system_prompt: str,
        messages: list[dict],
        model: str,
    ):
        stream = await self.or_client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system_prompt}, *messages],
            stream=True,
            temperature=TEMPERATURE,
            max_tokens=MAX_TOKENS,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def _stream_gemini(self, system_prompt: str, messages: list[dict]):
        contents = self._build_gemini_contents(messages)
        response = await self.gemini_client.aio.models.generate_content_stream(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,  # [FIX-18]
                temperature=TEMPERATURE,
                max_output_tokens=MAX_TOKENS,
            ),
        )
        async for chunk in response:
            if chunk.text:
                yield chunk.text

    # ════════════════════════════════════════════════════════════════════════════
    # PRIMARY STREAMING ENTRY POINT
    # Waterfall: Groq → OR[0..4] → Gemini
    # ════════════════════════════════════════════════════════════════════════════
    async def stream_response(
        self,
        *,
        messages:       list[dict],
        domain:         str = "sde",
        candidate_info: dict | None = None,
        resume_context: str = "",          # [FIX-15]
    ):
        system_prompt = self._build_system_prompt(domain, candidate_info, resume_context)

        # ── 1. Groq (fastest, primary) ─────────────────────────────────────────
        if self.groq_available:
            try:
                logger.debug("🤖 LLM: Groq %s", GROQ_MODEL)
                async for chunk in self._stream_groq(system_prompt, messages):
                    yield chunk
                return
            except Exception as e:
                logger.error("❌ Groq stream failed: %s — trying OpenRouter", e)

        # ── 2. OpenRouter — iterate through all 5 free models ─────────────────
        if self.or_available:
            for model in OR_MODELS:
                try:
                    logger.debug("🤖 LLM: OpenRouter %s", model)
                    async for chunk in self._stream_openrouter(system_prompt, messages, model):
                        yield chunk
                    return  # success — stop trying further
                except Exception as e:
                    logger.warning("⚠️ OpenRouter %s failed: %s — trying next model", model, e)
            logger.error("❌ All OpenRouter models exhausted — falling back to Gemini")

        # ── 3. Gemini (absolute last resort) ──────────────────────────────────
        if self.gemini_available:
            try:
                logger.debug("🤖 LLM: Gemini %s", GEMINI_MODEL)
                async for chunk in self._stream_gemini(system_prompt, messages):
                    yield chunk
                return
            except Exception as e:
                logger.error("❌ Gemini stream failed: %s — all backends exhausted", e)

        # ── All backends failed — yield graceful degradation message ──────────
        chairman = list(
            PANEL_PROFILES.get(domain, PANEL_PROFILES["sde"])["members"].keys()
        )[0]
        yield f"[{chairman}] System is under high load. Please hold on for a moment."

    # ════════════════════════════════════════════════════════════════════════════
    # NON-STREAMING (analytics worker, one-shot generation)
    # Same waterfall order as streaming
    # ════════════════════════════════════════════════════════════════════════════
    async def generate_response(
        self,
        *,
        messages:       list[dict],
        domain:         str = "sde",
        candidate_info: dict | None = None,
        resume_context: str = "",
    ) -> str:
        system_prompt = self._build_system_prompt(domain, candidate_info, resume_context)

        # ── 1. Groq ────────────────────────────────────────────────────────────
        if self.groq_available:
            try:
                resp = await self.groq_client.chat.completions.create(
                    model=GROQ_MODEL,
                    messages=[{"role": "system", "content": system_prompt}, *messages],
                    temperature=TEMPERATURE,
                    max_tokens=MAX_TOKENS,
                )
                return resp.choices[0].message.content
            except Exception as e:
                logger.error("❌ Groq generate failed: %s", e)

        # ── 2. OpenRouter — iterate through all 5 free models ─────────────────
        if self.or_available:
            for model in OR_MODELS:
                try:
                    resp = await self.or_client.chat.completions.create(
                        model=model,
                        messages=[{"role": "system", "content": system_prompt}, *messages],
                        temperature=TEMPERATURE,
                        max_tokens=MAX_TOKENS,
                    )
                    return resp.choices[0].message.content
                except Exception as e:
                    logger.warning("⚠️ OpenRouter generate %s failed: %s", model, e)

        # ── 3. Gemini ──────────────────────────────────────────────────────────
        if self.gemini_available:
            try:
                contents = self._build_gemini_contents(messages)
                response = await self.gemini_client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        temperature=TEMPERATURE,
                        max_output_tokens=MAX_TOKENS,
                    ),
                )
                return response.text
            except Exception as e:
                logger.error("❌ Gemini generate failed: %s", e)

        # ── All failed ─────────────────────────────────────────────────────────
        chairman = list(
            PANEL_PROFILES.get(domain, PANEL_PROFILES["sde"])["members"].keys()
        )[0]
        return f"[{chairman}] Please introduce yourself."


# Module-level singleton — imported by websockets.py and workers
llm_service = LLMService()