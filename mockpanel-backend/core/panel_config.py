# core/panel_config.py
# ════════════════════════════════════════════════════════════════════════════════
# PANEL PROFILES v3.0 — Natural Voice Distribution
#
# FIXES vs v2.0:
#   [PC-NEW-1]  Natural 2F+3M ratio for UPSC (was 3F+2M — too many female).
#   [PC-NEW-2]  SDE Tech Lead → PrabhatNeural (Male) — more realistic pressure.
#   [PC-NEW-3]  Chairman ALWAYS NeerjaNeural (female) — "Mam ki awaaz" guaranteed.
#   [PC-NEW-4]  PSU unchanged — HR female (realistic), rest male.
# ════════════════════════════════════════════════════════════════════════════════

from prompts.upsc_board   import SYSTEM_PROMPT as UPSC_PROMPT
from prompts.psu_panel    import SYSTEM_PROMPT as PSU_PROMPT
from prompts.sde_manager  import SYSTEM_PROMPT as SDE_PROMPT

PANEL_PROFILES = {

    # ── UPSC Civil Services Personality Test ──────────────────────────────────
    # [PC-NEW-1] 2 Female + 3 Male — natural board composition
    # [PC-NEW-3] Chairman = NeerjaNeural (female) always
    "upsc": {
        "system_prompt": UPSC_PROMPT,
        "members": {
            "Chairman": {
                "edge_voice": "en-IN-NeerjaNeural",       # Female — authoritative Mam
                "tts_rate":   "-8%",                      # Slow, measured
                "role":       "Board Chairman · IAS (Retd.)",
            },
            "Member 1": {
                "edge_voice": "en-IN-PrabhatNeural",      # Male — ex-IPS, sharp
                "tts_rate":   "+0%",
                "role":       "Board Member · IPS (Retd.) · Internal Security",
            },
            "Member 2": {
                "edge_voice": "en-GB-RyanNeural",         # Male — diplomatic IFS
                "tts_rate":   "-3%",
                "role":       "Board Member · IFS (Retd.) · Foreign Policy",
            },
            "Member 3": {
                "edge_voice": "en-IN-NeerjaNeural",       # Female — governance specialist
                "tts_rate":   "-3%",
                "role":       "Board Member · IAS (Retd.) · Governance & Ethics",
            },
            "Member 4": {
                "edge_voice": "en-US-GuyNeural",          # Male — academic depth
                "tts_rate":   "-5%",
                "role":       "Board Member · Eminent Academic · Optional Subject",
            },
        },
    },

    # ── PSU Recruitment Interview ──────────────────────────────────────────────
    # [PC-NEW-4] Unchanged — Director+TechExpert male, HR female (realistic)
    "psu": {
        "system_prompt": PSU_PROMPT,
        "members": {
            "Director": {
                "edge_voice": "en-IN-PrabhatNeural",      # Male — deep, senior
                "tts_rate":   "-8%",
                "role":       "Director / ED-Level Official · 30+ years",
            },
            "Technical Expert": {
                "edge_voice": "en-US-ChristopherNeural",  # Male — precise
                "tts_rate":   "+3%",                      # Faster — pressure
                "role":       "DGM (Technical) · Core Engineering",
            },
            "HR": {
                "edge_voice": "en-IN-NeerjaNeural",       # Female — HR specialist
                "tts_rate":   "-5%",
                "role":       "DGM (HR) · People & Culture",
            },
        },
    },

    # ── SDE / Tech Interview ───────────────────────────────────────────────────
    # [PC-NEW-2] Tech Lead → PrabhatNeural (male, pressure), EM stays female
    "sde": {
        "system_prompt": SDE_PROMPT,
        "members": {
            "Engineering Manager": {
                "edge_voice": "en-IN-NeerjaNeural",       # Female — collaborative EM
                "tts_rate":   "-5%",
                "role":       "Engineering Manager · Ownership & Fit",
            },
            "Senior Staff Engineer": {
                "edge_voice": "en-US-GuyNeural",          # Male — veteran depth
                "tts_rate":   "+0%",
                "role":       "Senior Staff Engineer · Systems Depth",
            },
            "Tech Lead": {
                "edge_voice": "en-IN-PrabhatNeural",      # [PC-NEW-2] Male — pressure
                "tts_rate":   "+3%",                      # Faster — sharp TL feel
                "role":       "Tech Lead · Day-to-day Engineering",
            },
        },
    },
}


# ════════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ════════════════════════════════════════════════════════════════════════════════

def get_chairman_name(domain: str) -> str:
    profile = PANEL_PROFILES.get(domain.lower(), PANEL_PROFILES["sde"])
    return list(profile["members"].keys())[0]


def get_speaker_voices(domain: str) -> dict[str, tuple[str, str]]:
    """Return {speaker_name: (edge_voice, tts_rate)} for a domain."""
    profile = PANEL_PROFILES.get(domain.lower(), PANEL_PROFILES["sde"])
    return {
        name: (m["edge_voice"], m["tts_rate"])
        for name, m in profile["members"].items()
    }


def get_tts_params(domain: str, speaker_name: str) -> tuple[str, str]:
    """Get (edge_voice, tts_rate) for a specific speaker. Falls back to chairman."""
    profile  = PANEL_PROFILES.get(domain.lower(), PANEL_PROFILES["sde"])
    members  = profile["members"]
    member   = members.get(speaker_name)
    if member:
        return (member["edge_voice"], member["tts_rate"])
    chairman = list(members.values())[0]
    return (chairman["edge_voice"], chairman["tts_rate"])