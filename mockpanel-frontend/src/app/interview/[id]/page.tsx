"use client";

// app/interview/[id]/page.tsx
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION v10.0 — GOOGLE MEET / YOUTUBE STYLE FLOATING UI
//
// FIXES:
//   [MEET-UI] 0% Body Scrolling. Strict flex-col 100dvh layout.
//   [MEET-UI] "Your turn to speak" badge completely removed.
//   [MEET-UI] Question naturally sits at the top (under header).
//   [MEET-UI] Captions act like YouTube CC — bottom-aligned, 3-4 lines max,
//             auto-scrolls older text out of view smoothly.
//   [MEET-UI] Control Dock is ultra-optimized. Icons shrunk (w-9 h-9 on mobile) 
//             and dock wraps tightly around them (w-fit) to prevent overflow.
// ════════════════════════════════════════════════════════════════════════════════

import {
  useMemo, useState, useRef, useEffect, useCallback,
  Component, type ErrorInfo, type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { useWebSocket }          from "@/hooks/useWebSocket";
import { useAudioRecorder }      from "@/hooks/useAudioRecorder";
import { useExpressionAnalysis } from "@/hooks/useExpressionAnalysis";
import { ThemeToggle }           from "@/components/ui/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";

const DOMAIN_CONFIG = {
  upsc: { title: "Personality Test",    badge: "UPSC",  color: "#f59e0b" },
  psu:  { title: "Executive Interview", badge: "PSU",   color: "#10b981" },
  sde:  { title: "Technical Interview", badge: "SDE",   color: "#6366f1" },
} as const;
type Domain = keyof typeof DOMAIN_CONFIG;

const SILENCE_LAYER_1_MS = 12_000;
const SILENCE_LAYER_2_MS = 22_000;
const SILENCE_LAYER_3_MS = 35_000;

const TOKEN_KEYS = ["token", "access_token", "auth_token", "authToken", "accessToken", "jwt", "userToken", "id_token"];
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
  } catch (_) {}
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ════════════════════════════════════════════════════════════════════════════════
class InterviewErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Crash:", error, info); }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--background)] px-6 text-center">
        <div className="text-4xl">⚠️</div><h2 className="text-xl font-bold">Something went wrong</h2>
        <p className="text-[var(--muted-foreground)] max-w-sm text-sm">{this.state.error?.message}</p>
        <button onClick={() => (window.location.href = "/dashboard")} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold">Back to Dashboard</button>
      </div>
    );
    return this.props.children;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// HOOKS
// ════════════════════════════════════════════════════════════════════════════════
function useSmartMic(active: boolean, stream: MediaStream | null): number {
  const [volume, setVolume] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (!active || !stream) { setVolume(0); return; }
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioCtx();
    const analyser = audioCtx.createAnalyser();
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0; for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      setVolume(sum / dataArray.length);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(rafRef.current); audioCtx.close().catch(() => {}); };
  }, [active, stream]);
  return volume;
}

function useSilenceReminder(sendJson: (p: Record<string, unknown>) => void, chairmanName: string, currentQuestion: string, enabled: boolean) {
  const t1Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t3Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAll = useCallback(() => {
    if (t1Ref.current) { clearTimeout(t1Ref.current); t1Ref.current = null; }
    if (t2Ref.current) { clearTimeout(t2Ref.current); t2Ref.current = null; }
    if (t3Ref.current) { clearTimeout(t3Ref.current); t3Ref.current = null; }
  }, []);
  const startTimer = useCallback(() => {
    clearAll();
    if (!enabled) return;
    t1Ref.current = setTimeout(() => sendJson({ type: "text", text: `[System: Silence reminder Layer 1] [${chairmanName}] Please take your time. We are listening.` }), SILENCE_LAYER_1_MS);
    t2Ref.current = setTimeout(() => sendJson({ type: "text", text: `[System: Silence reminder Layer 2] [${chairmanName}] Shall I rephrase the question? ${currentQuestion ? `"${currentQuestion.slice(0, 80)}..."` : ""}` }), SILENCE_LAYER_2_MS);
    t3Ref.current = setTimeout(() => sendJson({ type: "text", text: `[System: Silence reminder Layer 3] [${chairmanName}] Let us move to the next question.` }), SILENCE_LAYER_3_MS);
  }, [enabled, chairmanName, currentQuestion, sendJson, clearAll]);
  useEffect(() => () => clearAll(), [clearAll]);
  return { startTimer, clearAll };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════════
function InterviewRoomInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params?.id ?? "unknown";
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => { setToken(readToken()); }, []);

  const wsUrl = useMemo(() => {
    if (typeof window === "undefined" || token === undefined) return null;
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const wsHost  = isLocal ? "localhost:8000" : window.location.host;
    const proto   = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${wsHost}/ws/v1/interview/${sessionId}`;
  }, [sessionId, token]);

  const { status, messages, sendJson, stopAudio, isAudioPlaying } = useWebSocket(wsUrl, token ?? null);

  const [domain, setDomain] = useState<Domain>("sde");
  const [chairmanName, setChairmanName] = useState("Interviewer");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [questionNumber, setQuestionNumber] = useState(1);
  const [captionsText, setCaptionsText] = useState("");
  const [captionsLabel, setCaptionsLabel] = useState("AI Speaking");
  const [captionsColor, setCaptionsColor] = useState<"green"|"indigo"|"amber">("indigo");
  const [isThinking, setIsThinking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  
  // Premium UI Defaults
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);
  const [showQuestion, setShowQuestion] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [isUserFullScreen, setIsUserFullScreen] = useState(false);
  const [seconds, setSeconds] = useState(40 * 60);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [camAllowed, setCamAllowed] = useState<boolean | null>(null);

  const [interimText, setInterimText] = useState("");
  const isUserSpeakingRef = useRef(false);
  const audioUnlockedRef = useRef(false);
  const userVideoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  
  // Auto-scroll Ref for Captions (YouTube Style)
  const captionsEndRef = useRef<HTMLDivElement>(null);

  const [awaitingUserResponse, setAwaitingUserResponse] = useState(false);

  const { startTimer: startSilenceTimer, clearAll: clearSilenceTimer } = useSilenceReminder(
    sendJson as (p: Record<string, unknown>) => void, chairmanName, currentQuestion, awaitingUserResponse
  );

  const handleInterrupt = useCallback(() => { stopAudio(); sendJson({ type: "interrupt" }); clearSilenceTimer(); }, [stopAudio, sendJson, clearSilenceTimer]);
  const handleInterim = useCallback((text: string) => {
    isUserSpeakingRef.current = true; clearSilenceTimer();
    setCaptionsLabel("You"); setCaptionsColor("green"); setInterimText(text); setCaptionsText("");
  }, [clearSilenceTimer]);
  const handleFinal = useCallback((text: string) => {
    isUserSpeakingRef.current = false; setInterimText("");
    setCaptionsLabel("You"); setCaptionsColor("green"); setCaptionsText(text); clearSilenceTimer();
  }, [clearSilenceTimer]);

  const { isRecording, micError, stream: micStream } = useAudioRecorder(
    sendJson as (p: Record<string, unknown>) => void,
    { enabled: isMicOn, isAudioPlaying, onInterrupt: handleInterrupt, onInterim: handleInterim, onFinal: handleFinal }
  );

  const micVolume = useSmartMic(isMicOn && !micError, micStream);

  useEffect(() => { if (micError) { setShowTextInput(true); setIsMicOn(false); } }, [micError]);

  const { currentEmotion, isReady: camAnalysisReady } = useExpressionAnalysis(
    isCamOn ? userVideoRef : { current: null }, sendJson as (p: Record<string, unknown>) => void
  );

  useEffect(() => { if (status === "closed_unauthorized") router.replace(`/login?next=/interview/${sessionId}&reason=session_expired`); }, [status, router, sessionId]);

  useEffect(() => {
    if (!isCamOn) {
      camStreamRef.current?.getTracks().forEach(t => t.stop()); camStreamRef.current = null;
      if (userVideoRef.current) userVideoRef.current.srcObject = null; setCamAllowed(null); return;
    }
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        camStreamRef.current = stream; setCamAllowed(true);
        if (userVideoRef.current) { userVideoRef.current.srcObject = stream; userVideoRef.current.play().catch(console.error); }
      })
      .catch((err) => { console.error("Camera error:", err); if (!cancelled) { setCamAllowed(false); setIsCamOn(false); } });
    return () => { cancelled = true; camStreamRef.current?.getTracks().forEach(t => t.stop()); camStreamRef.current = null; };
  }, [isCamOn]);

  useEffect(() => {
    const t = setInterval(() => setSeconds(p => (p > 0 ? p - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const cleanText = useCallback((t: string) => t.replace(/\[.*?\]\s*/g, ""), []);
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
            if (msg.domain) setDomain(msg.domain as Domain);
            if (msg.chairman_name) setChairmanName(String(msg.chairman_name));
            break;
          case "speaker_change":
            setCaptionsLabel(String(msg.speaker ?? "AI Speaking")); setCaptionsColor("indigo"); break;
          case "silence_detected":
            setStatusMessage(String(msg.message ?? "Silence detected.")); setTimeout(() => setStatusMessage(""), 3000); break;
          case "ai_text_chunk":
          case "response_chunk":
            setCaptionsLabel("AI Speaking"); setCaptionsColor("indigo"); setIsThinking(false);
            setInterimText(""); setAwaitingUserResponse(false); clearSilenceTimer();
            if (msg.text) setCaptionsText(p => p + cleanText(String(msg.text)));
            break;
          case "transcription":
          case "transcript_final":
            setCaptionsLabel("You"); setCaptionsColor("green"); setInterimText("");
            if (msg.text) setCaptionsText(cleanText(String(msg.text)));
            break;
          case "response_complete":
            setCaptionsLabel("AI Speaking"); setCaptionsColor("indigo");
            if (msg.text) {
              const ct = cleanText(String(msg.text)); setCaptionsText(ct); setCurrentQuestion(ct); setQuestionNumber(p => p + 1);
            }
            setIsThinking(false); setAwaitingUserResponse(true); startSilenceTimer();
            break;
          case "question":
            if (msg.text) {
              const ct = cleanText(String(msg.text)); setCurrentQuestion(ct); setCaptionsText(ct);
              setCaptionsLabel("AI Speaking"); setCaptionsColor("indigo"); setQuestionNumber(p => p + 1);
            }
            setIsThinking(false); setAwaitingUserResponse(true); startSilenceTimer();
            break;
          case "thinking":
            setIsThinking(!!msg.status);
            if (msg.status) { setCaptionsLabel("Thinking…"); setCaptionsColor("amber"); setCaptionsText(""); setInterimText(""); setAwaitingUserResponse(false); clearSilenceTimer(); }
            break;
          case "error":
            if (msg.code === 401 || msg.code === 403) router.replace(`/login?next=/interview/${sessionId}&reason=session_expired`);
            break;
        }
      } catch (e) { console.error("Msg Error:", e); }
    }
  }, [messages, cleanText, router, sessionId, startSilenceTimer, clearSilenceTimer]);

  const submitTextInput = useCallback(() => {
    const text = textInput.trim(); if (!text) return;
    setCaptionsLabel("You"); setCaptionsColor("green"); setCaptionsText(text); setInterimText(""); clearSilenceTimer();
    sendJson({ type: "text", text }); setTextInput("");
  }, [textInput, sendJson, clearSilenceTimer]);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    const Cls = window.AudioContext || (window as any).webkitAudioContext;
    if (Cls) { const ctx = new Cls(); ctx.resume().then(() => ctx.close()).catch(() => {}); }
  }, []);

  const displayCaptionsText = interimText || captionsText;
  
  // Auto-scroll Captions to bottom (YouTube style)
  useEffect(() => {
    if (captionsEndRef.current) {
      captionsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayCaptionsText, isThinking]);

  // PiP Dragging
  const [isMounted, setIsMounted] = useState(false);
  const [pipPos, setPipPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ ox: 0, oy: 0, ix: 0, iy: 0 });

  useEffect(() => {
    setIsMounted(true);
    const w = window.innerWidth < 768 ? 90 : 140; 
    setPipPos({ x: window.innerWidth - w - 16, y: 60 }); 
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true); dragStart.current = { ox: e.clientX - pipPos.x, oy: e.clientY - pipPos.y, ix: e.clientX, iy: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const w = window.innerWidth < 768 ? 90 : 140;
    setPipPos({
      x: Math.min(Math.max(0, e.clientX - dragStart.current.ox), window.innerWidth - w),
      y: Math.min(Math.max(0, e.clientY - dragStart.current.oy), window.innerHeight - w * (4 / 3)),
    });
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false); e.currentTarget.releasePointerCapture(e.pointerId);
    if (Math.abs(e.clientX - dragStart.current.ix) + Math.abs(e.clientY - dragStart.current.iy) < 10) setIsUserFullScreen(p => !p);
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const domCfg = DOMAIN_CONFIG[domain] ?? DOMAIN_CONFIG.sde;
  const isTimeRunningOut = seconds < 300;
  const maxQuestions = questionNumber > 15 ? Math.ceil(questionNumber / 5) * 5 : 15;

  const displayCaptionsLabel = interimText ? "You" : captionsLabel;
  const displayCaptionsColor = interimText ? "green" : captionsColor;
  const showCursorBlink = !!interimText;

  const captionLabelClass = { green: "text-emerald-500", indigo: "text-indigo-400", amber: "text-amber-400" }[displayCaptionsColor];

  if (token === undefined) return <div className="min-h-screen flex items-center justify-center bg-[var(--background)]"><div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  const AIView = (
    <div className="w-full h-full flex items-center justify-center bg-[var(--background)] relative">
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--brand)]/5 to-transparent opacity-50" />
      <div className={`relative w-28 h-28 md:w-44 md:h-44 rounded-full border flex items-center justify-center bg-[var(--card)]/40 backdrop-blur-2xl shadow-2xl transition-all duration-700 ${
        isThinking ? "border-[var(--brand)]/50 shadow-[0_0_80px_rgba(99,102,241,0.4)] animate-pulse scale-[1.02]"
        : isAudioPlaying ? "border-emerald-500/40 shadow-[0_0_60px_rgba(16,185,129,0.3)] scale-[1.01]" : "border-[var(--border)]"
      }`}>
        <span className="text-4xl md:text-6xl font-black text-[var(--foreground)]">AI</span>
      </div>
    </div>
  );

  const UserView = (
    <div className="w-full h-full bg-black relative overflow-hidden flex items-center justify-center">
      {isCamOn && camAllowed === true ? (
        <video ref={userVideoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay playsInline muted />
      ) : (
        <div className="absolute inset-0 bg-[var(--muted)] flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-[var(--card)] flex items-center justify-center border border-[var(--border)]">
            <span className="text-sm font-black text-[var(--muted-foreground)]">YOU</span>
          </div>
          {camAllowed === false && <p className="absolute bottom-6 text-xs text-[var(--muted-foreground)]">🚫 Camera blocked</p>}
        </div>
      )}
      {isCamOn && camAllowed === true && currentEmotion && (
        <div className="absolute top-2 left-2 z-20 bg-[var(--card)]/80 backdrop-blur-md px-2 py-1 rounded-lg border border-[var(--border)]">
          <span className="text-[9px] font-bold uppercase text-[var(--foreground)]">{currentEmotion}</span>
        </div>
      )}
    </div>
  );

  // Buttons Common CSS
  const btnClass = "w-9 h-9 sm:w-10 sm:h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all pointer-events-auto flex-shrink-0";
  const iconClass = "w-4 h-4 md:w-[18px] md:h-[18px]";

  return (
    // Strict 100dvh flex-col container = 0 scrolling globally
    <main className="flex flex-col h-[100dvh] w-full bg-[var(--background)] overflow-hidden relative" onClick={unlockAudio}>
      
      {/* ── BACKGROUND LAYER ── */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-[var(--brand)] opacity-[0.04] blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-emerald-500 opacity-[0.03] blur-[120px]" />
      </div>

      {/* ── VIDEO / AI LAYER (Behind UI) ── */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {isUserFullScreen ? UserView : AIView}
      </div>

      {/* ── UI LAYER (Flex Column) ── */}
      <div className="relative z-20 flex flex-col h-full w-full pointer-events-none">
        
        {/* 1. TOP HEADER (Slim line) */}
        <header className="flex-none px-3 py-2.5 md:px-5 md:py-3 flex justify-between items-center bg-gradient-to-b from-[var(--background)] to-transparent pointer-events-auto">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse shadow-sm`} />
            <h1 className="text-xs md:text-sm font-bold text-[var(--foreground)] tracking-wide flex items-center gap-1.5">
              {domCfg.title} <span className="opacity-50 text-[10px] md:text-xs font-medium">Q{questionNumber}/{maxQuestions}</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className={`px-2 py-1 rounded-md border font-mono font-bold text-[10px] md:text-xs tracking-wide ${
              isTimeRunningOut ? "bg-red-500/20 border-red-500/50 text-red-500" : "bg-[var(--card)]/60 border-[var(--border)] text-[var(--foreground)] backdrop-blur-md"
            }`}>
              {formatTime(seconds)}
            </div>
          </div>
        </header>

        {/* 2. QUESTION BOX (Sticks to top under header) */}
        <div className="flex-none px-3 pt-1 pb-2 w-full flex justify-center pointer-events-none">
          <AnimatePresence>
            {showQuestion && currentQuestion && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                className="w-full max-w-2xl bg-[var(--card)]/80 backdrop-blur-2xl border border-[var(--border)] px-4 py-3 md:px-5 md:py-4 rounded-2xl shadow-xl text-center pointer-events-auto max-h-[18vh] overflow-y-auto hide-scrollbar">
                <span className="text-[9px] uppercase tracking-widest font-bold mb-1 block opacity-70" style={{ color: domCfg.color }}>Current Question</span>
                <p className="text-xs md:text-[15px] font-bold text-[var(--foreground)] leading-relaxed">"{currentQuestion}"</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 3. FLEXIBLE MIDDLE SPACE (Allows video to show, pushes controls down) */}
        <div className="flex-1 min-h-0 pointer-events-none relative">
          {/* PiP (Draggable) lives in the flexible space */}
          {isMounted && (
            <div
              onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
              style={{ transform: `translate(${pipPos.x}px, ${pipPos.y}px)` }}
              className={`absolute top-2 left-0 w-24 md:w-32 aspect-[3/4] rounded-xl overflow-hidden border border-[var(--border)] shadow-xl touch-none pointer-events-auto
                ${isDragging ? "cursor-grabbing scale-105" : "cursor-grab hover:scale-[1.02]"} bg-[var(--card)]/80 backdrop-blur-md transition-transform`}
            >
              <div className="w-full h-full pointer-events-none">{!isUserFullScreen ? UserView : AIView}</div>
            </div>
          )}
        </div>

        {/* 4. ALERTS & INPUT (Stacking above dock) */}
        <div className="flex-none px-3 w-full flex flex-col items-center gap-2 pointer-events-none pb-2">
          <AnimatePresence>
            {statusMessage && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-2 bg-amber-500/20 px-3 py-1 rounded-full border border-amber-500/30 backdrop-blur-md pointer-events-auto">
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">{statusMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showTextInput && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="w-full max-w-2xl flex gap-2 pointer-events-auto">
                <input value={textInput} onChange={e => setTextInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitTextInput()} placeholder="Type your answer…" className="flex-1 bg-[var(--card)]/90 border border-[var(--border)] rounded-xl px-4 py-2 text-[var(--foreground)] text-sm outline-none backdrop-blur-md" />
                <button onClick={submitTextInput} className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold text-sm">Send</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 5. CAPTIONS BOX (YouTube Style - Bottom Aligned) */}
        <div className="flex-none px-3 w-full flex justify-center pointer-events-none pb-3">
          <AnimatePresence>
            {showCaptions && (displayCaptionsText || isThinking) && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                className="w-full max-w-2xl bg-[var(--card)]/90 backdrop-blur-2xl border border-[var(--border)] p-3 md:p-4 rounded-2xl shadow-xl flex flex-col pointer-events-auto">
                <span className={`text-[9px] uppercase tracking-widest font-bold mb-1 ${captionLabelClass}`}>{displayCaptionsLabel}</span>
                {/* Max ~3 lines, auto-scrolls perfectly */}
                <div className="max-h-[3.8rem] md:max-h-[4.2rem] overflow-y-auto hide-scrollbar scroll-smooth">
                  <span className="text-[var(--foreground)] text-xs md:text-sm font-medium leading-snug">
                    {displayCaptionsText || (isThinking ? "…" : "")}
                    {showCursorBlink && <span className="inline-block w-[2px] h-3 ml-1 bg-emerald-500 animate-pulse align-middle" />}
                  </span>
                  <div ref={captionsEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 6. CONTROL DOCK (Ultra Compact Pill) */}
        <div className="flex-none w-full pb-4 px-2 flex justify-center pointer-events-none">
          <div className="bg-[var(--card)]/80 backdrop-blur-3xl border border-[var(--border)] rounded-full shadow-2xl flex items-center justify-center gap-1 sm:gap-2 px-1.5 py-1.5 w-fit pointer-events-auto">
            
            <button onClick={() => setShowQuestion(p => !p)} className={`${btnClass} ${showQuestion ? "bg-[var(--muted)] text-[var(--foreground)]" : "bg-transparent text-[var(--muted-foreground)] border-transparent"}`}>
              <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
            
            <button onClick={() => setShowCaptions(p => !p)} className={`${btnClass} ${showCaptions ? "bg-[var(--muted)] text-[var(--foreground)]" : "bg-transparent text-[var(--muted-foreground)] border-transparent"}`}>
              <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M10 13H8a1 1 0 01-1-1v-2a1 1 0 011-1h2M16 13h-2a1 1 0 01-1-1v-2a1 1 0 011-1h2" /></svg>
            </button>
            
            <button onClick={() => setShowTextInput(p => !p)} className={`${btnClass} ${showTextInput ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "bg-transparent text-[var(--muted-foreground)] border-transparent"}`}>
              <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
            </button>

            <div className="w-[1px] h-4 bg-[var(--border)] mx-0.5 flex-shrink-0" />

            <button onClick={() => setIsCamOn(p => !p)} className={`${btnClass} ${isCamOn ? "bg-[var(--muted)] text-[var(--foreground)]" : "bg-red-500/90 text-white border-red-400"}`}>
              <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                {!isCamOn && <line x1="3" y1="3" x2="21" y2="21" strokeWidth={2.5} strokeLinecap="round" />}
              </svg>
            </button>

            <div className="relative flex items-center justify-center flex-shrink-0 w-9 h-9 sm:w-10 sm:h-10 md:w-11 md:h-11">
              {isMicOn && !micError && <div className="absolute inset-0 bg-emerald-500/40 rounded-full" style={{ transform: `scale(${1 + micVolume / 100})`, opacity: Math.max(0.1, micVolume / 100), filter: "blur(6px)", transition: "transform 75ms" }} />}
              <button onClick={() => setIsMicOn(p => !p)} disabled={!!micError} className={`w-full h-full relative z-10 rounded-full flex items-center justify-center border transition-all ${isMicOn && !micError ? "bg-[var(--muted)] border-[var(--border)] text-[var(--foreground)]" : "bg-red-500/90 border-red-400 text-white disabled:opacity-50"}`}>
                <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isMicOn && !micError ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /> : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><line x1="17" y1="7" x2="23" y2="13" strokeWidth={2.5} strokeLinecap="round" /><line x1="23" y1="7" x2="17" y2="13" strokeWidth={2.5} strokeLinecap="round" /></>}
                </svg>
              </button>
            </div>

            <div className="w-[1px] h-4 bg-[var(--border)] mx-0.5 flex-shrink-0" />

            <button onClick={handleInterrupt} className={`${btnClass} bg-transparent border-transparent text-[var(--foreground)] hover:bg-[var(--muted)]`}>
              <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>
            </button>

            <button onClick={() => router.push(`/results/${sessionId}`)} className="w-12 h-9 sm:w-14 sm:h-10 md:w-16 md:h-11 rounded-[14px] bg-red-600 hover:bg-red-700 text-white flex items-center justify-center flex-shrink-0 transition-colors shadow-md ml-0.5">
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Global CSS for scroll hiding */}
      <style jsx global>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </main>
  );
}

export default function InterviewRoomPage() {
  return <InterviewErrorBoundary><InterviewRoomInner /></InterviewErrorBoundary>;
}