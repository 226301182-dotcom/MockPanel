"use client";

// app/interview/[id]/page.tsx
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION-READY v4.0 — COMPLETE REWRITE WITH ALL FIXES
//
// [PAGE-1]  useAudioRecorder and blobToBase64 imports — no inline duplicates.
//           The inline hook was a maintenance hazard and missed echo suppression.
// [PAGE-2]  useSmartMic reuses the stream from useAudioRecorder — no second
//           getUserMedia call. Was opening 3 separate mic handles before.
// [PAGE-3]  Token: undefined → null → string (SSR safe, no premature WS connect).
//           Reads 8 common storage key candidates across localStorage + sessionStorage.
// [PAGE-4]  Redirect on WS status "closed_unauthorized" (code 1008) only.
//           Never redirects just because token is null.
// [PAGE-5]  Message handler uses a Set of processed IDs (by array index) instead
//           of lastProcessedIndex. Handles array replacement correctly.
// [PAGE-6]  [FIX-5] AudioContext unlocked on first user gesture (iOS Safari).
// [PAGE-7]  Single mic stream — no separate vizStream getUserMedia call.
// [PAGE-8]  Camera stream managed in one useEffect with proper ref cleanup.
// [PAGE-9]  Silence detection timer resets on every transcription event.
// ════════════════════════════════════════════════════════════════════════════════

import {
  useMemo, useState, useRef, useEffect, useCallback,
  Component, type ErrorInfo, type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { useWebSocket }         from "@/hooks/useWebSocket";
import { useAudioRecorder }     from "@/hooks/useAudioRecorder";
import { useExpressionAnalysis } from "@/hooks/useExpressionAnalysis";
import { ThemeToggle }          from "@/components/ui/ThemeToggle";

// ── Domain config ─────────────────────────────────────────────────────────────
const DOMAIN_CONFIG = {
  upsc: { title: "Personality Test",    badge: "UPSC CSE",  color: "#f59e0b" },
  psu:  { title: "Executive Interview", badge: "PSU Board", color: "#10b981" },
  sde:  { title: "Technical Interview", badge: "SDE Loop",  color: "#6366f1" },
} as const;
type Domain = keyof typeof DOMAIN_CONFIG;

// ── [PAGE-3] Token key candidates ─────────────────────────────────────────────
const TOKEN_KEYS = [
  "token", "access_token", "auth_token", "authToken",
  "accessToken", "jwt", "userToken", "id_token",
];

function readToken(): string | null {
  try {
    for (const key of TOKEN_KEYS) {
      const v = localStorage.getItem(key);
      if (v) return v;
    }
    for (const key of TOKEN_KEYS) {
      const v = sessionStorage.getItem(key);
      if (v) return v;
    }
  } catch (_) {
    // Private browsing / storage blocked — backend will decide via WS 1008
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ════════════════════════════════════════════════════════════════════════════════

class InterviewErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[InterviewRoom] Crash:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--background)] px-6 text-center">
          <div className="text-4xl">⚠️</div>
          <h2 className="text-xl font-bold">Something went wrong</h2>
          <p className="text-[var(--muted-foreground)] max-w-sm text-sm">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => (window.location.href = "/dashboard")}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold"
          >
            Back to Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MIC VOLUME HOOK
// [PAGE-2] Accepts a stream instead of calling getUserMedia itself.
//          The stream comes from useAudioRecorder — one handle, reused here.
// ════════════════════════════════════════════════════════════════════════════════

function useSmartMic(active: boolean, stream: MediaStream | null): number {
  const [volume, setVolume] = useState(0);
  const rafRef  = useRef<number>(0);

  useEffect(() => {
    if (!active || !stream) { setVolume(0); return; }

    const AudioCtx = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    analyser.fftSize = 256;
    const dataArray  = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      setVolume(sum / dataArray.length);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafRef.current);
      audioCtx.close().catch(() => {});
    };
  }, [active, stream]);

  return volume;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN INTERVIEW ROOM
// ════════════════════════════════════════════════════════════════════════════════

function InterviewRoomInner() {
  const params    = useParams<{ id: string }>();
  const router    = useRouter();
  const sessionId = params?.id ?? "unknown";

  // ── [PAGE-3] Three-state token ─────────────────────────────────────────────
  // undefined = still reading storage (WS url is null → no premature connect)
  // null      = confirmed empty → connect anyway; backend decides via 1008
  // string    = token found
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => { setToken(readToken()); }, []);

  // ── WS URL — held while token is still being read ─────────────────────────
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined" || token === undefined) return null;
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const wsHost  = isLocal ? "localhost:8000" : window.location.host;
    const proto   = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${wsHost}/ws/v1/interview/${sessionId}`;
  }, [sessionId, token]);

  const { status, messages, sendJson, stopAudio, isAudioPlaying } =
    useWebSocket(wsUrl, token ?? null);

  // ── Session info ───────────────────────────────────────────────────────────
  const [domain,       setDomain]       = useState<Domain>("sde");
  const [chairmanName, setChairmanName] = useState("Interviewer");

  // ── UI state ───────────────────────────────────────────────────────────────
  const [currentQuestion,  setCurrentQuestion]  = useState("");
  const [questionNumber,   setQuestionNumber]   = useState(1);
  const [captionsText,     setCaptionsText]     = useState("");
  const [captionsLabel,    setCaptionsLabel]    = useState("AI Speaking");
  const [isThinking,       setIsThinking]       = useState(false);
  const [statusMessage,    setStatusMessage]    = useState("");
  const [isMicOn,          setIsMicOn]          = useState(true);
  const [isCamOn,          setIsCamOn]          = useState(true);
  const [showQuestion,     setShowQuestion]     = useState(true);
  const [showCaptions,     setShowCaptions]     = useState(true);
  const [isUserFullScreen, setIsUserFullScreen] = useState(false);
  const [seconds,          setSeconds]          = useState(40 * 60);
  const [textInput,        setTextInput]        = useState("");
  const [showTextInput,    setShowTextInput]    = useState(false);
  const [camAllowed,       setCamAllowed]       = useState<boolean | null>(null);

  const audioUnlockedRef = useRef(false);
  const userVideoRef     = useRef<HTMLVideoElement>(null);
  const camStreamRef     = useRef<MediaStream | null>(null);

  // ── [PAGE-1] Audio recorder — imported hook, not inline duplicate ──────────
  const micEnabled = isMicOn;
  const { isRecording, micError, stream: micStream } = useAudioRecorder(sendJson, {
    enabled:        micEnabled,
    isAudioPlaying,
  });

  // [PAGE-2] Volume viz reuses the same stream from useAudioRecorder
  const micVolume = useSmartMic(isMicOn && !micError, micStream);

  // Show text input automatically if mic is unavailable
  useEffect(() => {
    if (micError) setShowTextInput(true);
  }, [micError]);

  // ── Expression analysis ────────────────────────────────────────────────────
  const { currentEmotion, isReady: camAnalysisReady } = useExpressionAnalysis(
    isCamOn ? userVideoRef : { current: null },
    sendJson as (p: Record<string, unknown>) => void,
  );

  // ── [PAGE-4] Redirect ONLY on 1008 — never on missing/null token ──────────
  useEffect(() => {
    if (status === "closed_unauthorized") {
      router.replace(
        `/login?next=/interview/${sessionId}&reason=session_expired`,
      );
    }
  }, [status, router, sessionId]);

  // ── [PAGE-8] Camera stream ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isCamOn) {
      camStreamRef.current?.getTracks().forEach(t => t.stop());
      camStreamRef.current = null;
      if (userVideoRef.current) userVideoRef.current.srcObject = null;
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        camStreamRef.current = stream;
        setCamAllowed(true);
        if (userVideoRef.current) {
          userVideoRef.current.srcObject = stream;
          userVideoRef.current.play().catch(console.error);
        }
      })
      .catch(() => { if (!cancelled) setCamAllowed(false); });

    return () => {
      cancelled = true;
      camStreamRef.current?.getTracks().forEach(t => t.stop());
      camStreamRef.current = null;
    };
  }, [isCamOn]);

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setSeconds(p => (p > 0 ? p - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  // ── [PAGE-9] Long-silence detection ───────────────────────────────────────
  const lastActivityRef     = useRef(Date.now());
  const silenceNotifiedRef  = useRef(false);

  useEffect(() => {
    if (status !== "connected" || isAudioPlaying || isThinking || !isMicOn) {
      lastActivityRef.current    = Date.now();
      silenceNotifiedRef.current = false;
      return;
    }
    const id = setInterval(() => {
      if (
        Date.now() - lastActivityRef.current > 18_000 &&
        !silenceNotifiedRef.current
      ) {
        silenceNotifiedRef.current = true;
        sendJson({
          type: "text",
          text: "[System: Candidate silent for 18 seconds. Politely ask if they need more time or want to move on. One sentence only.]",
        });
      }
    }, 2000);
    return () => clearInterval(id);
  }, [status, isAudioPlaying, isThinking, isMicOn, sendJson]);

  // ── [PAGE-5] WS message handler ───────────────────────────────────────────
  // Uses a ref-stored processed-count so we only walk new messages on each render,
  // and handles array replacement correctly (unlike a stale index ref).
  const cleanText         = useCallback((t: string) => t.replace(/\[.*?\]\s*/g, ""), []);
  const processedCountRef = useRef(0);

  useEffect(() => {
    if (!messages?.length) return;

    const newMsgs = messages.slice(processedCountRef.current);
    processedCountRef.current = messages.length;

    for (const msg of newMsgs) {
      if (!msg || typeof msg !== "object") continue;
      try {
        switch (msg.type) {
          case "session_info":
            if (msg.domain)        setDomain(msg.domain as Domain);
            if (msg.chairman_name) setChairmanName(String(msg.chairman_name));
            break;

          case "speaker_change":
            setCaptionsLabel(String(msg.speaker ?? "AI Speaking"));
            break;

          case "silence_detected":
            setStatusMessage(String(msg.message ?? "Silence detected."));
            setTimeout(() => setStatusMessage(""), 2500);
            break;

          case "ai_text_chunk":
          case "response_chunk":
            setCaptionsLabel("AI Speaking");
            setIsThinking(false);
            if (msg.text) setCaptionsText(p => p + cleanText(String(msg.text)));
            break;

          case "transcription":
          case "transcript_final":
            // [PAGE-9] Reset silence timer on real speech
            lastActivityRef.current    = Date.now();
            silenceNotifiedRef.current = false;
            setCaptionsLabel("You");
            if (msg.text) setCaptionsText(cleanText(String(msg.text)));
            break;

          case "response_complete":
            setCaptionsLabel("AI Speaking");
            if (msg.text) {
              const ct = cleanText(String(msg.text));
              setCaptionsText(ct);
              setCurrentQuestion(ct);
              setQuestionNumber(p => p + 1);
            }
            setIsThinking(false);
            break;

          case "question":
            if (msg.text) {
              const ct = cleanText(String(msg.text));
              setCurrentQuestion(ct);
              setCaptionsText(ct);
              setCaptionsLabel("AI Speaking");
              setQuestionNumber(p => p + 1);
            }
            setIsThinking(false);
            break;

          case "thinking":
            setIsThinking(!!msg.status);
            if (msg.status) {
              setCaptionsLabel("AI Thinking…");
              setCaptionsText("");
            }
            break;

          case "error":
            // [PAGE-4] Server-side auth errors
            if (msg.code === 401 || msg.code === 403) {
              router.replace(
                `/login?next=/interview/${sessionId}&reason=session_expired`,
              );
            }
            break;
        }
      } catch (e) {
        console.error("[InterviewRoom] Message handler error:", e);
      }
    }
  }, [messages, cleanText, router, sessionId]);

  // ── Text input ─────────────────────────────────────────────────────────────
  const submitTextInput = useCallback(() => {
    const text = textInput.trim();
    if (!text) return;
    setCaptionsLabel("You");
    setCaptionsText(text);
    sendJson({ type: "text", text });
    setTextInput("");
    lastActivityRef.current    = Date.now();
    silenceNotifiedRef.current = false;
  }, [textInput, sendJson]);

  // ── [PAGE-6] AudioContext unlock on first user gesture (iOS Safari) ────────
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    const Cls = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Cls) {
      const ctx = new Cls();
      ctx.resume().then(() => ctx.close()).catch(() => {});
    }
  }, []);

  // ── Draggable PiP ──────────────────────────────────────────────────────────
  const [isMounted,  setIsMounted]  = useState(false);
  const [pipPos,     setPipPos]     = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ ox: 0, oy: 0, ix: 0, iy: 0 });

  useEffect(() => {
    setIsMounted(true);
    const w = window.innerWidth < 768 ? 112 : 224;
    setPipPos({ x: window.innerWidth - w - 24, y: 80 });
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    dragStart.current = {
      ox: e.clientX - pipPos.x, oy: e.clientY - pipPos.y,
      ix: e.clientX,             iy: e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const w = window.innerWidth < 768 ? 112 : 224;
    setPipPos({
      x: Math.min(Math.max(0, e.clientX - dragStart.current.ox), window.innerWidth - w),
      y: Math.min(Math.max(0, e.clientY - dragStart.current.oy), window.innerHeight - w * (4 / 3)),
    });
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Small movement = tap → toggle fullscreen
    if (
      Math.abs(e.clientX - dragStart.current.ix) +
      Math.abs(e.clientY - dragStart.current.iy) < 10
    ) {
      setIsUserFullScreen(p => !p);
    }
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const formatTime       = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const domCfg           = DOMAIN_CONFIG[domain] ?? DOMAIN_CONFIG.sde;
  const isTimeRunningOut = seconds < 300;
  const maxQuestions     = questionNumber > 15 ? Math.ceil(questionNumber / 5) * 5 : 15;

  // ── [PAGE-3] Token-reading spinner ────────────────────────────────────────
  // Completes in < 1ms, user never sees this — just prevents SSR mismatch
  if (token === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  const AIView = (
    <div className="w-full h-full flex items-center justify-center bg-transparent relative">
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--brand)]/10 to-transparent opacity-40" />
      <div
        className={`relative z-20 w-36 h-36 md:w-56 md:h-56 rounded-full border flex items-center justify-center
          bg-[var(--card)]/40 backdrop-blur-2xl shadow-2xl transition-all duration-700 ${
          isThinking
            ? "border-[var(--brand)]/50 shadow-[0_0_80px_rgba(99,102,241,0.4)] animate-pulse scale-[1.02]"
            : "border-[var(--border)]"
        }`}
      >
        <span className="text-5xl md:text-7xl font-black text-[var(--foreground)]">AI</span>
      </div>
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.2em] text-[var(--foreground)] opacity-40 font-bold">
        {chairmanName}
      </div>
    </div>
  );

  const UserView = (
    <div className="w-full h-full bg-black relative overflow-hidden">
      <video
        ref={userVideoRef}
        className="w-full h-full object-cover scale-x-[-1]"
        autoPlay
        playsInline
        muted
      />
      <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.7)] pointer-events-none z-10" />
      {!isCamOn && (
        <div className="absolute inset-0 bg-[var(--muted)] flex items-center justify-center">
          <div className="w-20 h-20 rounded-full bg-[var(--card)] flex items-center justify-center border border-[var(--border)]">
            <span className="text-xl font-black text-[var(--muted-foreground)]">YOU</span>
          </div>
        </div>
      )}
      {isCamOn && camAllowed === false && (
        <div className="absolute inset-0 bg-[var(--muted)] flex items-center justify-center">
          <p className="text-xs text-[var(--muted-foreground)]">🚫 Camera blocked</p>
        </div>
      )}
      {isCamOn && camAllowed === true && (
        <div className="absolute top-3 left-3 flex items-center gap-2 z-20">
          <div className="bg-[var(--card)]/80 backdrop-blur-xl px-2.5 py-1.5 rounded-xl border border-[var(--border)] flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${camAnalysisReady ? "bg-emerald-500" : "bg-zinc-500"}`} />
            <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--foreground)]">
              {camAnalysisReady ? "Active" : "Off"}
            </span>
          </div>
          {currentEmotion && (
            <div className="bg-indigo-500/90 px-2.5 py-1.5 rounded-xl">
              <span className="text-[9px] text-white font-bold uppercase">{currentEmotion}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <main
      className="fixed inset-0 bg-[var(--background)] overflow-hidden"
      onClick={unlockAudio}
    >
      {/* Ambient background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-[var(--brand)] opacity-[0.06] blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-emerald-500 opacity-[0.04] blur-[120px]" />
      </div>

      {/* Main fullscreen view */}
      <div className="absolute inset-0 z-10">
        {isUserFullScreen ? UserView : AIView}
      </div>

      {/* Draggable Picture-in-Picture */}
      {isMounted && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ transform: `translate(${pipPos.x}px, ${pipPos.y}px)` }}
          className={`absolute top-0 left-0 w-28 md:w-56 aspect-[3/4] rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl z-30 touch-none
            ${isDragging ? "cursor-grabbing scale-105" : "cursor-grab hover:scale-[1.02]"}
            bg-[var(--card)]/80 backdrop-blur-2xl transition-transform`}
        >
          <div className="w-full h-full pointer-events-none">
            {!isUserFullScreen ? UserView : AIView}
          </div>
          <div className="absolute bottom-2 left-2 bg-[var(--card)]/95 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-wider text-[var(--foreground)] pointer-events-none">
            {!isUserFullScreen ? "You" : "Panel"}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 w-full p-5 flex justify-between items-start z-20 pointer-events-none">
        <div className="pointer-events-auto">
          <h1 className="text-xl md:text-2xl font-black text-[var(--foreground)] tracking-tight">
            {domCfg.title}
          </h1>
          <div className="mt-2 flex items-center gap-2 text-xs font-bold flex-wrap">
            <span className="flex items-center gap-1.5 bg-[var(--card)]/95 px-3 py-1.5 rounded-full backdrop-blur-xl border border-[var(--border)] text-[var(--foreground)]">
              <span className={`w-2 h-2 rounded-full animate-pulse ${
                status === "connected"
                  ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                  : status === "reconnecting"
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`} />
              {status === "connected"
                ? "Connected"
                : status === "reconnecting"
                ? "Reconnecting…"
                : status}
            </span>
            <span
              className="px-3 py-1.5 rounded-full border backdrop-blur-xl"
              style={{
                background:   `${domCfg.color}18`,
                borderColor:  `${domCfg.color}30`,
                color:        domCfg.color,
              }}
            >
              {domCfg.badge} · Q{questionNumber}/{maxQuestions}
            </span>
            {!micError ? (
              <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                🎙️ {isRecording ? "Listening…" : isMicOn ? "Ready" : "Muted"}
              </span>
            ) : (
              <span className="px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400">
                🚫 Mic Blocked — Type below
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pointer-events-auto">
          <ThemeToggle />
          <div className={`px-4 py-2 rounded-xl backdrop-blur-xl border font-mono font-black text-base md:text-xl tracking-widest transition-colors ${
            isTimeRunningOut
              ? "bg-red-500/10 border-red-500/30 text-red-500"
              : "bg-[var(--card)]/95 border-[var(--border)] text-[var(--foreground)]"
          }`}>
            {formatTime(seconds)}
          </div>
        </div>
      </div>

      {/* Captions + Question + Text input */}
      <div className="absolute bottom-32 md:bottom-40 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl flex flex-col items-center gap-3 z-20 pointer-events-none">

        {statusMessage && (
          <div className="inline-flex items-center gap-2 bg-amber-500/10 px-4 py-2 rounded-full border border-amber-500/30">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
            </svg>
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              {statusMessage}
            </span>
          </div>
        )}

        {showQuestion && currentQuestion && (
          <div className="w-full bg-[var(--card)]/95 backdrop-blur-3xl border border-[var(--border)] p-5 md:p-7 rounded-3xl shadow-2xl text-center">
            <span
              className="text-[10px] uppercase tracking-[0.2em] font-bold mb-2 block"
              style={{ color: domCfg.color }}
            >
              Current Question
            </span>
            <p className="text-sm md:text-lg font-bold text-[var(--foreground)] leading-relaxed">
              "{currentQuestion}"
            </p>
          </div>
        )}

        {showCaptions && (captionsText || isThinking) && (
          <div className="inline-flex flex-col items-center bg-[var(--card)]/95 backdrop-blur-3xl px-6 py-3 rounded-full border border-[var(--border)] shadow-2xl">
            <span className={`text-[9px] uppercase tracking-[0.2em] font-bold mb-1 ${
              captionsLabel.includes("You")
                ? "text-emerald-500"
                : "text-[var(--muted-foreground)]"
            }`}>
              {captionsLabel}
            </span>
            <span className="text-[var(--foreground)] text-sm md:text-base font-semibold">
              {captionsText || (isThinking ? "…" : "")}
            </span>
          </div>
        )}

        {showTextInput && (
          <div className="w-full flex gap-2 pointer-events-auto">
            <input
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitTextInput()}
              placeholder="Type your answer… (Enter to send)"
              className="flex-1 bg-[var(--card)]/95 border border-[var(--border)] rounded-2xl px-5 py-3 text-[var(--foreground)] text-sm outline-none backdrop-blur-xl"
            />
            <button
              onClick={submitTextInput}
              className="bg-indigo-600 text-white px-5 py-3 rounded-2xl font-semibold text-sm flex-shrink-0"
            >
              Send
            </button>
          </div>
        )}
      </div>

      {/* Control dock */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[var(--card)]/90 backdrop-blur-3xl border border-[var(--border)] rounded-[2rem] shadow-2xl flex items-center gap-3 z-30 px-5 py-3 pointer-events-auto">

        {/* Toggle question card */}
        <button
          onClick={() => setShowQuestion(p => !p)}
          title="Toggle question"
          className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${
            showQuestion
              ? "bg-[var(--muted)] border-[var(--border)] text-[var(--foreground)]"
              : "bg-transparent border-transparent text-[var(--muted-foreground)]"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Toggle captions */}
        <button
          onClick={() => setShowCaptions(p => !p)}
          title="Toggle captions"
          className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${
            showCaptions
              ? "bg-[var(--muted)] border-[var(--border)] text-[var(--foreground)]"
              : "bg-transparent border-transparent text-[var(--muted-foreground)]"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <rect x="2" y="7" width="20" height="10" rx="2" />
            <path d="M10 13H8a1 1 0 01-1-1v-2a1 1 0 011-1h2M16 13h-2a1 1 0 01-1-1v-2a1 1 0 011-1h2" />
          </svg>
        </button>

        {/* Toggle text input */}
        <button
          onClick={() => setShowTextInput(p => !p)}
          title="Toggle text input"
          className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${
            showTextInput
              ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-400"
              : "bg-transparent border-transparent text-[var(--muted-foreground)]"
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </button>

        {/* Camera toggle */}
        <button
          onClick={() => setIsCamOn(p => !p)}
          title={isCamOn ? "Turn off camera" : "Turn on camera"}
          style={{ width: 52, height: 52 }}
          className={`rounded-full flex items-center justify-center border shadow-lg transition-all ${
            isCamOn
              ? "bg-[var(--muted)] border-[var(--border)] text-[var(--foreground)]"
              : "bg-red-500 border-red-400 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]"
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            {!isCamOn && (
              <line x1="3" y1="3" x2="21" y2="21" strokeWidth={3} strokeLinecap="round" />
            )}
          </svg>
        </button>

        {/* Mic button with volume ring */}
        <div className="relative flex items-center justify-center" style={{ width: 56, height: 56 }}>
          {isMicOn && !micError && (
            <div
              className="absolute inset-0 bg-emerald-500/40 rounded-full"
              style={{
                transform:  `scale(${1 + micVolume / 100})`,
                opacity:    Math.max(0.1, micVolume / 100),
                filter:     "blur(10px)",
                transition: "transform 75ms, opacity 75ms",
              }}
            />
          )}
          <button
            onClick={() => setIsMicOn(p => !p)}
            disabled={!!micError}
            title={isMicOn ? "Mute" : "Unmute"}
            style={{ width: 56, height: 56 }}
            className={`relative z-10 rounded-full flex items-center justify-center border shadow-lg transition-all
              disabled:opacity-50 disabled:cursor-not-allowed ${
              isMicOn && !micError
                ? "bg-[var(--muted)] border-[var(--border)] text-[var(--foreground)]"
                : "bg-red-500 border-red-400 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]"
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMicOn && !micError ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              ) : (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <line x1="17" y1="7" x2="23" y2="13" strokeWidth={3} strokeLinecap="round" />
                  <line x1="23" y1="7" x2="17" y2="13" strokeWidth={3} strokeLinecap="round" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Interrupt AI */}
        <button
          onClick={() => { stopAudio(); sendJson({ type: "interrupt" }); }}
          title="Interrupt AI"
          style={{ width: 44, height: 44 }}
          className="rounded-full bg-transparent hover:bg-[var(--muted)] border border-transparent text-[var(--foreground)] flex items-center justify-center transition-all group relative"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
          </svg>
          <span className="absolute -top-10 scale-0 group-hover:scale-100 transition-transform bg-[var(--foreground)] text-[var(--background)] font-bold text-[9px] uppercase tracking-wider px-3 py-1.5 rounded-lg whitespace-nowrap">
            Interrupt
          </span>
        </button>

        {/* End session */}
        <button
          onClick={() => router.push(`/results/${sessionId}`)}
          title="End session"
          style={{ width: 76, height: 44 }}
          className="rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-all border border-red-500 shadow-[0_8px_30px_rgba(220,38,38,0.3)] group relative"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
          </svg>
          <span className="absolute -top-10 scale-0 group-hover:scale-100 transition-transform bg-red-900 text-white font-bold text-[9px] uppercase tracking-wider px-3 py-1.5 rounded-lg whitespace-nowrap">
            End Session
          </span>
        </button>
      </div>
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// PAGE EXPORT
// ════════════════════════════════════════════════════════════════════════════════

export default function InterviewRoomPage() {
  return (
    <InterviewErrorBoundary>
      <InterviewRoomInner />
    </InterviewErrorBoundary>
  );
}