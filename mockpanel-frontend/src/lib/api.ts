// lib/api.ts
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION FIXES:
//   1. All URLs from env vars — no more localhost hardcoding
//   2. Single source of truth for API_BASE and WS_BASE
//   3. Removed API_BASE_URL_LEGACY (dead port 8002 reference)
//   4. Auth token injected from localStorage/session — prepared for real auth
//   5. apiRequest includes Authorization header when token present
//   6. CreateSessionRequest typed correctly (mode field included)
//   7. ADDED: deleteSession and deleteAllSessions methods
// ════════════════════════════════════════════════════════════════════════════════

// ── Environment-driven URLs (set these in .env.local / Vercel dashboard) ─────
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:8000/api/v1";

export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "") ||
  "ws://localhost:8000/ws/v1";

// ── Auth token helpers ────────────────────────────────────────────────────────
function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mockpanel_token") || null;
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("mockpanel_token", token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("mockpanel_token");
}

// ── Generic request handler ───────────────────────────────────────────────────
async function apiRequest<T>(
  endpoint: string,
  options:  RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const url   = `${API_BASE}${endpoint}`;

  const config: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    let detail = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const err = await response.json();
      detail    = err.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }

  return response.json();
}

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface Session {
  session_id: string;
  user_id:    string;
  domain:     "upsc" | "psu" | "sde";
  settings:   Record<string, unknown>;
  status:     string;
  created_at: string;
}

export interface CreateSessionRequest {
  domain:          "upsc" | "psu" | "sde";
  mode?:           "interview" | "coach";
  name?:           string;
  targetYear?:     string;
  durationMinutes?: number;
  difficulty?:     "Easy" | "Moderate" | "Hard";
  language?:       "English" | "Hindi" | "Hinglish";
  topic?:          string;
  settings?:       Record<string, unknown>;
}

export interface AnalyticsData {
  session_id:        string;
  status:            "processing" | "completed" | "aborted_too_short" | "failed";
  message?:          string;
  scores?: {
    technical:         number;
    communication:     number;
    confidence:        number;
    ethical_integrity: number;
    overall:           number;
  };
  analysis?: {
    strengths:       string[];
    weaknesses:      string[];
    recommendations: string[];
  };
  question_analysis?: Array<{
    question:      string;
    feedback:      string;
    ideal_approach?: string;
  }>;
  transcript?: string;
  stats?: {
    total_questions: number;
    total_responses: number;
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// SESSION API
// ════════════════════════════════════════════════════════════════════════════════

export const sessionAPI = {
  createSession: (data: CreateSessionRequest) =>
    apiRequest<Session>("/sessions", {
      method: "POST",
      body:   JSON.stringify(data),
    }),

  getSessions: () =>
    apiRequest<Session[]>("/sessions"),

  getSession: (sessionId: string) =>
    apiRequest<Session>(`/sessions/${sessionId}`),

  // 🔥 NEW: Delete a specific session
  deleteSession: (sessionId: string) =>
    apiRequest<{ message: string }>(`/sessions/${sessionId}`, {
      method: "DELETE",
    }),

  // 🔥 NEW: Delete all sessions
  deleteAllSessions: () =>
    apiRequest<{ message: string }>("/sessions", {
      method: "DELETE",
    }),

  uploadResume: async (
    sessionId: string,
    file:      File,
  ): Promise<{ message: string; text_length: number }> => {
    const token    = getAuthToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/sessions/${sessionId}/resume`, {
      method:  "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    formData,
      // Note: No Content-Type header — browser sets multipart boundary automatically
    });

    if (!response.ok) {
      let detail = `Upload failed: ${response.statusText}`;
      try { detail = (await response.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }

    return response.json();
  },

  getAnalytics: (sessionId: string) =>
    apiRequest<AnalyticsData>(`/sessions/${sessionId}/analytics`),
};

// ════════════════════════════════════════════════════════════════════════════════
// WS URL BUILDER
// ════════════════════════════════════════════════════════════════════════════════

export function buildWsUrl(sessionId: string): string {
  // Auto-upgrade to WSS on HTTPS pages
  let base = WS_BASE;
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    base.startsWith("ws://")
  ) {
    base = base.replace("ws://", "wss://");
  }
  const token = getAuthToken();
  return token
    ? `${base}/interview/${sessionId}?token=${encodeURIComponent(token)}`
    : `${base}/interview/${sessionId}`;
}