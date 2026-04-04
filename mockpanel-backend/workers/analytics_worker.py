# workers/analytics_worker.py

# ════════════════════════════════════════════════════════════════════════════════

# FIXES APPLIED:

#   [FIX-26] Analytics now uses NEW google.genai SDK (same as llm_service.py).

#            Old `google.generativeai` package removed. No more SDK split.

#   [FIX-25] Speaker tag regex now strips trailing colon too.

#            "[Technical Expert]:" → colon no longer corrupts transcript lines.

# ════════════════════════════════════════════════════════════════════════════════



import logging

import json

import asyncio

import re

import time

from db.supabase_client import get_global_supabase_client



logger = logging.getLogger("uvicorn")



ANALYZING_TIMEOUT_SECONDS = 600  # 10 minutes



ANALYTICS_SYSTEM_PROMPT = """

You are an elite, brutally honest Expert Evaluator for {domain_upper} interviews.

You have evaluated 10,000+ candidates. You do not sugarcoat.



Analyze the interview transcript below and return a structured JSON report.



════════════════════════════════════════════════════════════════

EVALUATION CRITERIA (score each 0–100):

════════════════════════════════════════════════════════════════



1. technical_score     — Genuine domain knowledge vs surface recall. Survival of follow-ups.

2. communication_score — Answer structure (intro → argument → example → conclusion). Clarity.

3. confidence_score    — Composure under pressure. Honest "I don't know" vs bluffing.

4. ethical_integrity_score — Genuine values vs rehearsed platitudes.

5. overall_score       — Holistic judgment, NOT a mathematical average. Weight key moments.



════════════════════════════════════════════════════════════════

CRITICAL RULES:

════════════════════════════════════════════════════════════════

- Return ONLY valid JSON. No markdown. No ```json. No preamble. No explanation after.

- Be SPECIFIC — reference actual transcript content in strengths/weaknesses.

- question_analysis: pick the 3–5 most revealing exchanges only.



════════════════════════════════════════════════════════════════

REQUIRED JSON STRUCTURE (output exactly this, nothing else):

════════════════════════════════════════════════════════════════

{

  "technical_score": <integer 0-100>,

  "communication_score": <integer 0-100>,

  "confidence_score": <integer 0-100>,

  "ethical_integrity_score": <integer 0-100>,

  "overall_score": <integer 0-100>,

  "strengths": [

    "<specific strength with transcript evidence>",

    "<specific strength>",

    "<specific strength>"

  ],

  "weaknesses": [

    "<specific weakness with evidence and how to fix>",

    "<specific weakness>",

    "<specific weakness>"

  ],

  "recommendations": [

    "<concrete actionable next step>",

    "<concrete actionable next step>",

    "<concrete actionable next step>"

  ],

  "question_analysis": [

    {

      "question": "Exact or paraphrased interviewer question",

      "feedback": "Specific critique — what worked, what didn't, why",

      "ideal_approach": "How a top 1% candidate would have answered"

    }

  ]

}

"""



# [FIX-25] Updated regex: strips speaker tags AND optional trailing colon/space

# Before: r'\[[A-Za-z][A-Za-z .]{0,30}\]\s*'

# After:  r'\[[A-Za-z][A-Za-z .]{0,30}\]:?\s*'   ← note :? for optional colon

_SPEAKER_TAG_RE = re.compile(r'\[[A-Za-z][A-Za-z .]{0,30}\]:?\s*')

_JSON_FENCE_RE  = re.compile(r'^```(?:json)?\s*|\s*```\s*$', re.MULTILINE)





async def _db(fn):

    return await asyncio.to_thread(fn)





# ════════════════════════════════════════════════════════════════════════════════

# LLM CALL FOR EVALUATION

# [FIX-26] Uses new google.genai SDK consistently with llm_service.py

# ════════════════════════════════════════════════════════════════════════════════



async def _call_llm_for_evaluation(system_prompt: str, transcript: str) -> str:

    from core.config import settings



    user_message = {

        "role": "user",

        "content": (

            f"### INTERVIEW TRANSCRIPT\n\n{transcript}\n\n"

            "### TASK\n"

            "Generate the JSON evaluation for this interview. "

            "Return ONLY the JSON object — no other text:"

        ),

    }



    # ── Groq ───────────────────────────────────────────────────────────────────

    if getattr(settings, "groq_api_key", None):

        try:

            from groq import AsyncGroq

            client = AsyncGroq(api_key=settings.groq_api_key)

            resp   = await client.chat.completions.create(

                model="llama-3.1-8b-instant",

                messages=[

                    {"role": "system", "content": system_prompt},

                    user_message,

                ],

                temperature=0.2,

                max_tokens=2000,

            )

            return resp.choices[0].message.content

        except Exception as e:

            logger.error("❌ Groq eval failed: %s", e)



    # ── OpenRouter ────────────────────────────────────────────────────────────

    if getattr(settings, "openrouter_api_key", None):

        try:

            from openai import AsyncOpenAI

            client = AsyncOpenAI(

                base_url="https://openrouter.ai/api/v1",

                api_key=settings.openrouter_api_key,

            )

            resp = await client.chat.completions.create(

                model="meta-llama/llama-3.1-8b-instruct:free",

                messages=[

                    {"role": "system", "content": system_prompt},

                    user_message,

                ],

                temperature=0.2,

                max_tokens=2000,

            )

            return resp.choices[0].message.content

        except Exception as e:

            logger.error("❌ OpenRouter eval failed: %s", e)



    # ── Gemini — [FIX-26] New SDK with system_instruction ────────────────────

    if getattr(settings, "gemini_api_key", None):

        try:

            from google import genai

            from google.genai import types



            client = genai.Client(api_key=settings.gemini_api_key)

            response = await client.aio.models.generate_content(

                model="gemini-2.5-flash",

                contents=[

                    types.Content(

                        role="user",

                        parts=[types.Part(text=user_message["content"])],

                    )

                ],

                config=types.GenerateContentConfig(

                    system_instruction=system_prompt,   # [FIX-26] Correct param

                    temperature=0.2,

                    max_output_tokens=2000,

                ),

            )

            return response.text

        except Exception as e:

            logger.error("❌ Gemini eval failed: %s", e)



    return ""





# ════════════════════════════════════════════════════════════════════════════════

# JSON EXTRACTION

# ════════════════════════════════════════════════════════════════════════════════



def _extract_json(raw: str) -> dict:

    if not raw:

        raise ValueError("Empty LLM response")



    clean = _JSON_FENCE_RE.sub("", raw).strip()



    if clean.startswith("{"):

        try:

            return json.loads(clean)

        except json.JSONDecodeError:

            pass



    match = re.search(r'\{.*\}', clean, re.DOTALL)

    if match:

        try:

            return json.loads(match.group(0))

        except json.JSONDecodeError as e:

            raise ValueError(f"Found JSON block but failed to parse: {e}") from e



    raise ValueError("No JSON object found in LLM output")





# ════════════════════════════════════════════════════════════════════════════════

# MAIN ANALYTICS GENERATOR

# ════════════════════════════════════════════════════════════════════════════════



async def generate_session_analytics(session_id: str) -> None:

    logger.info("📊 Analytics started: %s", session_id)

    raw_response = ""

    client = get_global_supabase_client()



    try:

        session_res = await _db(

            lambda: client.table("interviews").select("*").eq("id", session_id).execute()

        )

        if not session_res.data:

            logger.error("❌ Session not found: %s", session_id)

            return



        session_data = session_res.data[0]

        domain       = session_data.get("domain", "sde").lower()



        msg_res = await _db(

            lambda: client.table("interview_messages")

                          .select("*")

                          .eq("session_id", session_id)

                          .order("created_at")

                          .execute()

        )

        messages = msg_res.data or []



        user_responses  = sum(1 for m in messages if m["role"] == "user")

        assistant_turns = sum(1 for m in messages if m["role"] == "assistant")



        if user_responses < 2:

            logger.warning("⚠️ Session %s too short (%d responses). Aborting.", session_id, user_responses)

            await _db(

                lambda: client.table("interviews")

                              .update({"status": "aborted_too_short"})

                              .eq("id", session_id)

                              .execute()

            )

            return



        # [FIX-25] Speaker tag regex now strips trailing colon too

        transcript_lines = []

        for m in messages:

            role          = "Interviewer" if m["role"] == "assistant" else "Candidate"

            clean_content = _SPEAKER_TAG_RE.sub("", m.get("content", "")).strip()

            if clean_content:

                transcript_lines.append(f"[{role}]: {clean_content}")



        transcript = "\n\n".join(transcript_lines)



        eval_system  = ANALYTICS_SYSTEM_PROMPT.replace("{domain_upper}", domain.upper())

        raw_response = await _call_llm_for_evaluation(eval_system, transcript)

        logger.debug("Raw LLM eval [%s]: %.200s…", session_id, raw_response)



        report = _extract_json(raw_response)



        def safe_int(v, default: int = 0) -> int:

            try:    return max(0, min(100, int(v)))

            except: return default



        def safe_list(v, default=None) -> list:

            return v if isinstance(v, list) else (default or [])



        analytics_payload = {

            "session_id":              session_id,

            "technical_score":         safe_int(report.get("technical_score")),

            "communication_score":     safe_int(report.get("communication_score")),

            "confidence_score":        safe_int(report.get("confidence_score")),

            "ethical_integrity_score": safe_int(report.get("ethical_integrity_score")),

            "overall_score":           safe_int(report.get("overall_score")),

            "strengths":               safe_list(report.get("strengths")),

            "weaknesses":              safe_list(report.get("weaknesses")),

            "recommendations":         safe_list(report.get("recommendations")),

            "question_analysis":       safe_list(report.get("question_analysis")),

            "transcript":              transcript,

            "total_questions":         assistant_turns,

            "total_user_responses":    user_responses,

        }



        await _db(

            lambda: client.table("final_analytics")

                          .upsert(analytics_payload, on_conflict="session_id")

                          .execute()

        )

        await _db(

            lambda: client.table("interviews")

                          .update({"status": "completed"})

                          .eq("id", session_id)

                          .execute()

        )



        logger.info(

            "✅ Analytics saved [%s] — Overall: %d, Tech: %d, Comm: %d",

            session_id,

            analytics_payload["overall_score"],

            analytics_payload["technical_score"],

            analytics_payload["communication_score"],

        )



    except (json.JSONDecodeError, ValueError) as e:

        logger.error("❌ JSON parse failed [%s]: %s", session_id, e)

        logger.debug("Raw output: %.500s", raw_response)

        try:

            await _db(

                lambda: client.table("interviews")

                              .update({"status": "failed"})

                              .eq("id", session_id)

                              .execute()

            )

        except Exception:

            pass



    except Exception as e:

        logger.error("❌ Analytics generation failed [%s]: %s", session_id, e, exc_info=True)

        try:

            await _db(

                lambda: client.table("interviews")

                              .update({"status": "failed"})

                              .eq("id", session_id)

                              .execute()

            )

        except Exception:

            pass





# ════════════════════════════════════════════════════════════════════════════════

# PUBLIC ENTRY POINT

# ════════════════════════════════════════════════════════════════════════════════



async def enqueue_analytics_generation(session_id: str) -> None:

    client = get_global_supabase_client()

    try:

        res = await _db(

            lambda: client.table("interviews")

                          .select("status, updated_at")

                          .eq("id", session_id)

                          .execute()

        )

        if not res.data:

            logger.warning("⚠️ enqueue_analytics: session %s not found", session_id)

            return



        row            = res.data[0]

        current_status = row.get("status", "")

        updated_at     = row.get("updated_at")



        if current_status in ("completed", "aborted_too_short", "failed"):

            logger.info("⏭️ Skipping analytics [%s] (status: %s)", session_id, current_status)

            return



        if current_status == "analyzing" and updated_at:

            try:

                from datetime import datetime, timezone

                updated_dt  = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))

                elapsed_sec = (datetime.now(timezone.utc) - updated_dt).total_seconds()

                if elapsed_sec < ANALYZING_TIMEOUT_SECONDS:

                    logger.info("⏭️ Session %s already analyzing (%ds ago) — skipping", session_id, int(elapsed_sec))

                    return

                else:

                    logger.warning("♻️ Session %s stuck in 'analyzing' for %ds — retrying", session_id, int(elapsed_sec))

            except Exception:

                pass



        await _db(

            lambda: client.table("interviews")

                          .update({"status": "analyzing"})

                          .eq("id", session_id)

                          .execute()

        )



        asyncio.create_task(generate_session_analytics(session_id))

        logger.info("🚀 Analytics task enqueued: %s", session_id)



    except Exception as e:

        logger.error("❌ enqueue_analytics_generation failed [%s]: %s", session_id, e)