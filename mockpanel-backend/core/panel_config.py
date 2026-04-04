# core/panel_config.py
# ════════════════════════════════════════════════════════════════════════════════
# PANEL PROFILES — All three domains: UPSC, PSU, SDE
# Each member has a voice_id (ElevenLabs) and role descriptor.
# Chairman is always index 0 — WS handler picks it for silence notifications.
# ════════════════════════════════════════════════════════════════════════════════

from prompts.upsc_board import SYSTEM_PROMPT as UPSC_PROMPT
from prompts.psu_panel import SYSTEM_PROMPT as PSU_PROMPT
from prompts.sde_manager import SYSTEM_PROMPT as SDE_PROMPT

PANEL_PROFILES = {

    # ── UPSC Civil Services Personality Test ─────────────────────────────────
    "upsc": {
        "system_prompt": UPSC_PROMPT,
        "members": {
            "Chairman": {
                "voice_id": "pNInz6obpgDQGcFmaJgB",   # Adam — deep, authoritative
                "role":     "Board Chairman · IAS (Retd.)"
            },
            "Member 1": {
                "voice_id": "VR6AaFsHqHg7MvM",          # Arnold — firm, ex-IPS
                "role":     "Board Member · IPS (Retd.)"
            },
            "Member 2": {
                "voice_id": "ErXw93pU699Pshq97A0f",      # Antoni — calm, ex-IFS
                "role":     "Board Member · IFS (Retd.)"
            },
            "Member 3": {
                "voice_id": "GBv7mTt0atIp3Br8iCZE",      # Thomas — academic
                "role":     "Board Member · Eminent Academic"
            },
            "Member 4": {
                "voice_id": "oWAxZDx7w5VEj9dCyTzz",      # Grace — governance
                "role":     "Board Member · IAS (Retd.) Governance"
            },
        },
    },

    # ── PSU Recruitment Interview (NTPC / BHEL / ONGC / IOCL / SAIL) ─────────
    "psu": {
        "system_prompt": PSU_PROMPT,
        "members": {
            "Director": {
                "voice_id": "pNInz6obpgDQGcFmaJgB",      # Adam — senior, measured
                "role":     "Director / ED-Level Official"
            },
            "Technical Expert": {
                "voice_id": "ErXw93pU699Pshq97A0f",      # Antoni — domain specialist
                "role":     "DGM (Technical) · Core Engineering"
            },
            "HR": {
                "voice_id": "oWAxZDx7w5VEj9dCyTzz",      # Grace — HR specialist
                "role":     "DGM (HR) · People & Culture"
            },
        },
    },

    # ── SDE / Tech Interview (FAANG, Tier-1 Indian Product Companies) ─────────
    "sde": {
        "system_prompt": SDE_PROMPT,
        "members": {
            "Engineering Manager": {
                "voice_id": "pNInz6obpgDQGcFmaJgB",      # Adam — calm EM
                "role":     "Engineering Manager · Team Lead"
            },
            "Senior Staff Engineer": {
                "voice_id": "VR6AaFsHqHg7MvM",           # Arnold — veteran engineer
                "role":     "Senior Staff Engineer · Systems"
            },
            "Tech Lead": {
                "voice_id": "ErXw93pU699Pshq97A0f",      # Antoni — sharp TL
                "role":     "Tech Lead · Current Team"
            },
        },
    },
}


def get_chairman_name(domain: str) -> str:
    """Return the first (chairman) speaker name for a given domain."""
    profile = PANEL_PROFILES.get(domain.lower(), PANEL_PROFILES["sde"])
    return list(profile["members"].keys())[0]


def get_speaker_voices(domain: str) -> dict[str, str]:
    """Return {speaker_name: voice_id} mapping for a domain."""
    profile = PANEL_PROFILES.get(domain.lower(), PANEL_PROFILES["sde"])
    return {name: m["voice_id"] for name, m in profile["members"].items()}