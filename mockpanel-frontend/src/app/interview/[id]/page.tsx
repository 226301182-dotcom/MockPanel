"use client";

// app/interview/[id]/page.tsx
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION v15.0 — MODULAR ARCHITECTURE + FLAWLESS RESPONSIVE UI
//
// FIXES & UPDATES:
//   [ARCHITECTURE] Merged user's modular component structure (AIAvatar, ControlButton).
//   [UI FIX] Re-applied strict Flexbox layout to prevent ALL overlap issues.
//   [CAPTIONS] Restored fixed-height, bottom-up auto-scrolling for captions.
//   [DOCK] Maintained industry-standard hierarchy: Secondary -> Mic/Cam -> Action.
// ════════════════════════════════════════════════════════════════════════════════

import {
  useMemo, useState, useRef, useEffect, useCallback, memo,
  Component, type ErrorInfo, type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import { useWebSocket }          from "@/hooks/useWebSocket";
import { useAudioRecorder }      from "@/hooks/useAudioRecorder";
import { useExpressionAnalysis } from "@/hooks/useExpressionAnalysis";
import { ThemeToggle }           from "@/components/ui/ThemeToggle";
import { motion, AnimatePresence } from "framer-motion";

// --- Types & Config ---
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#09090b] px-6 text-center text-white">
        <div className="text-4xl">⚠️</div><h2 className="text-xl font-bold">Something went wrong</h2>
        <p className="text-gray-400 max-w-sm text-sm">{this.state.error?.message}</p>
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
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════════════

const AIAvatar = memo(({ isThinking, isAudioPlaying }: { isThinking: boolean; isAudioPlaying: boolean }) => (
  <div className="w-full h-full flex items-center justify-center bg-[#09090b] relative">
    <div className={`relative w-36 h-36 sm:w-40 sm:h-40 md:w-56 md:h-56 rounded-full bg-[#18181b] flex items-center justify-center transition-all duration-500 ${
      isThinking ? "shadow-[0_0_40px_rgba(99,102,241,0.2)] border border-indigo-500/40 scale-[1.02]" 
      : isAudioPlaying ? "shadow-[0_0_50px_rgba(16,185,129,0.3)] border border-emerald-500/50 scale-[1.03]" 
      : "border border-white/5"
    }`}>
      {isAudioPlaying && <div className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping opacity-30" />}
      {isThinking && <div className="absolute inset-0 rounded-full border border-indigo-500/40 animate-ping opacity-30" />}
      <span className="text-4xl sm:text-5xl md:text-7xl font-bold text-white tracking-tight z-10">AI</span>
    </div>
  </div>
));
AIAvatar.displayName = "AIAvatar";

// Minimal SVG Icons (To replace external dependencies while matching Google Meet look)
const Icons = {
  Question: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Captions: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M10 13H8a1 1 0 01-1-1v-2a1 1 0 011-1h2M16 13h-2a1 1 0 01-1-1v-2a1 1 0 011-1h2" /></svg>,
  Chat: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  MicOn: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>,
  MicOff: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><line x1="17" y1="7" x2="23" y2="13" strokeWidth={2.5} strokeLinecap="round" /><line x1="23" y1="7" x2="17" y2="13" strokeWidth={2.5} strokeLinecap="round" /></svg>,
  CamOn: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
  CamOff: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /><line x1="3" y1="3" x2="21" y2="21" strokeWidth={2.5} strokeLinecap="round" /></svg>,
  Interrupt: () => <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>,
  EndCall: () => <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" /></svg>,
};

const ControlButton = memo(({ onClick, active, icon: Icon, color = "default", title, disabled = false }: any) => {
  const baseClass = "w-[44px] h-[44px] sm:w-[48px] sm:h-[48px] rounded-full flex items-center justify-center transition-all pointer-events-auto flex-shrink-0 shadow-lg";
  const variants = {
    default: active ? "bg-white/10 text-white border border-white/20" : "bg-[#18181b] border border-white/5 text-gray-400 hover:bg-white/10",
    danger: active ? "bg-[#27272a] text-white border border-white/10" : "bg-[#dc2626] text-white border border-red-500",
    end: "w-[50px] h-[44px] sm:w-[60px] sm:h-[48px] rounded-[1.2rem] bg-[#dc2626] hover:bg-red-700 text-white border border-red-500 ml-1"
  };

  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${baseClass} ${variants[color as keyof typeof variants]} ${disabled ? 'opacity-50' : 'active:scale-95'}`}>
      <Icon />
    </button>
  );
});
ControlButton.displayName = "ControlButton";

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
  
  const [isMicOn, setIsMicOn] = useState(true); // MIC DEFAULT ON
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
  
  const captionsEndRef = useRef<HTMLDivElement>(null);
  const [awaitingUserResponse, setAwaitingUserResponse] = useState(false);

  const { startTimer: startSilenceTimer, clearAll: clearSilenceTimer } = useSilenceReminder(
    sendJson as (p: Record<string, unknown>) => void, chairmanName, currentQuestion, awaitingUserResponse
  );

  const handleInterrupt = useCallback(() => { stopAudio(); sendJson({ type: "interrupt" }); clearSilenceTimer(); }, [stopAudio, sendJson, clearSilenceTimer]);
  const handleInterim = useCallback((text: string) => {
    isUserSpeakingRef.current = true; clearSilenceTimer();
    setCaptionsLabel("You (speaking…)"); setCaptionsColor("green"); setInterimText(text); setCaptionsText("");
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
    if (!messages || messages.length === 0) {
      processedCountRef.current = 0; return;
    }
    if (processedCountRef.current > messages.length) {
      processedCountRef.current = 0;
    }
    const newMsgs = messages.slice(processedCountRef.current);
    processedCountRef.current = messages.length;

    for (const msg of newMsgs) {
      if (!msg || typeof msg !== "object") continue;
      try {
        const msgText = msg.text ? String(msg.text) : "";
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
            if (msgText) setCaptionsText(p => p + cleanText(msgText));
            break;
          case "transcription":
          case "transcript_final":
            setCaptionsLabel("You"); setCaptionsColor("green"); setInterimText("");
            if (msgText) setCaptionsText(cleanText(msgText));
            break;
          case "response_complete":
            setCaptionsLabel("AI Speaking"); setCaptionsColor("indigo");
            if (msgText) {
              const ct = cleanText(msgText); setCaptionsText(ct); setCurrentQuestion(ct); setQuestionNumber(p => p + 1);
            }
            setIsThinking(false); setAwaitingUserResponse(true); startSilenceTimer();
            break;
          case "question":
            if (msgText) {
              const ct = cleanText(msgText); setCurrentQuestion(ct); setCaptionsText(ct);
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

  // Auto Scroll Captions
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
    const w = window.innerWidth < 768 ? 90 : 160; 
    setPipPos({ x: window.innerWidth - w - 16, y: 80 }); 
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true); dragStart.current = { ox: e.clientX - pipPos.x, oy: e.clientY - pipPos.y, ix: e.clientX, iy: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const w = window.innerWidth < 768 ? 90 : 160;
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
  const displayCaptionsLabel = interimText ? "You (speaking…)" : captionsLabel;
  const displayCaptionsColor = interimText ? "green" : captionsColor;
  const showCursorBlink = !!interimText;

  const captionLabelClass = { green: "text-emerald-500", indigo: "text-indigo-400", amber: "text-amber-400" }[displayCaptionsColor];

  if (token === undefined) return <div className="min-h-screen flex items-center justify-center bg-[#09090b]"><div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>;

  // ── USER PiP ──
  const UserView = (
    <div className="w-full h-full bg-[#18181b] relative overflow-hidden flex items-center justify-center rounded-xl md:rounded-2xl">
      {isCamOn && camAllowed === true ? (
        <video ref={userVideoRef} className="w-full h-full object-cover scale-x-[-1]" autoPlay playsInline muted />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[#18181b]">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-[#09090b] flex items-center justify-center border border-white/5">
            <span className="text-[10px] sm:text-[13px] font-bold text-blue-100/90 tracking-wide">YOU</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <main className="h-[100dvh] w-full bg-[#09090b] overflow-hidden relative font-sans flex flex-col" onClick={unlockAudio}>
      
      {/* ── BACKGROUND LAYER (Video/AI) ── */}
      <div className="absolute inset-0 z-0">
        {isUserFullScreen ? UserView : <AIAvatar isThinking={isThinking} isAudioPlaying={isAudioPlaying} />}
      </div>

      {/* ── PiP ── */}
      {isMounted && (
        <div
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
          style={{ transform: `translate(${pipPos.x}px, ${pipPos.y}px)` }}
          className={`absolute top-0 left-0 w-24 sm:w-28 md:w-40 aspect-[3/4] rounded-xl md:rounded-2xl overflow-hidden shadow-2xl z-40 touch-none
            ${isDragging ? "cursor-grabbing scale-105" : "cursor-grab hover:scale-[1.02]"} border border-white/5 bg-[#18181b] transition-transform`}
        >
          <div className="w-full h-full pointer-events-none">{!isUserFullScreen ? UserView : <AIAvatar isThinking={isThinking} isAudioPlaying={isAudioPlaying} />}</div>
        </div>
      )}

      {/* ── HEADER ── */}
      <header className="w-full flex-none h-16 md:h-20 z-30 flex justify-between items-center px-4 md:px-5 pointer-events-none">
        
        {/* Left Side: Dot & Title */}
        <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto flex-1 min-w-0 mr-4">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <h1 className="text-sm sm:text-[15px] font-bold text-white/95 tracking-wide truncate">
            {domCfg.title.replace('\n', ' ')}
          </h1>
        </div>

        {/* Right Side: Q Counter, Theme, Timer */}
        <div className="flex items-center gap-2 sm:gap-4 pointer-events-auto flex-shrink-0">
          <span className="text-[11px] sm:text-[13px] font-semibold text-gray-500 hidden sm:block">Q{questionNumber}/15</span>
          <ThemeToggle />
          <div className="px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-[10px] sm:rounded-[12px] bg-[#18181b] border border-white/5 font-mono font-bold text-[11px] sm:text-[13px] text-white/90">
            {formatTime(seconds)}
          </div>
        </div>
      </header>

      {/* ── FLEXIBLE OVERLAYS WRAPPER ── */}
      <div className="flex-1 w-full relative z-20 flex flex-col px-3 sm:px-4 pb-[90px] md:pb-[110px] pointer-events-none overflow-hidden gap-2">
        
        {/* TOP: Question Box */}
        {showQuestion && currentQuestion && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="w-full max-w-2xl mx-auto bg-[#18181b]/95 backdrop-blur-xl border border-white/10 p-3 sm:p-5 rounded-xl sm:rounded-2xl shadow-2xl text-center pointer-events-auto flex-shrink min-h-0 overflow-y-auto hide-scrollbar">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold mb-1.5 sm:mb-2 block text-gray-400">Current Question</span>
            <p className="text-xs sm:text-sm md:text-base font-semibold text-white/95 leading-relaxed">"{currentQuestion}"</p>
          </motion.div>
        )}

        {/* BOTTOM: Status, Input, Captions */}
        <div className="mt-auto w-full max-w-2xl mx-auto flex flex-col gap-3 pointer-events-auto flex-shrink-0">
          
          <AnimatePresence>
            {statusMessage && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="self-center inline-flex items-center bg-[#18181b] px-3 py-1 sm:px-4 sm:py-1.5 rounded-full border border-amber-500/30 shadow-lg">
                <span className="text-[9px] sm:text-[11px] font-bold text-amber-500 uppercase tracking-wider">{statusMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showTextInput && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} 
                className="w-full flex items-center gap-2 p-1.5 bg-[#18181b] border border-white/10 rounded-2xl shadow-xl">
                <input 
                  value={textInput} 
                  onChange={e => setTextInput(e.target.value)} 
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitTextInput()} 
                  placeholder="Type your answer…" 
                  className="flex-1 bg-transparent px-3 py-2 text-white text-xs sm:text-sm outline-none placeholder:text-gray-500 min-w-0" 
                />
                <button 
                  onClick={submitTextInput} 
                  className="bg-white text-black px-4 py-2 rounded-xl font-bold text-xs sm:text-sm flex-shrink-0 transition-transform active:scale-95">
                  Send
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showCaptions && (displayCaptionsText || isThinking) && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="w-full h-[5rem] sm:h-[6rem] bg-[#18181b]/95 backdrop-blur-xl border border-white/10 rounded-xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden flex-shrink-0 p-3 sm:p-4">
                
                <span className={`text-[8px] sm:text-[10px] uppercase tracking-widest font-bold mb-1 sm:mb-1.5 flex-shrink-0 ${captionLabelClass}`}>
                  {displayCaptionsLabel}
                </span>

                <div className="flex-1 overflow-y-auto hide-scrollbar flex flex-col justify-end">
                  <span className="text-white/90 text-xs sm:text-sm md:text-base font-medium leading-snug">
                    {displayCaptionsText || (isThinking ? "…" : "")}
                    {showCursorBlink && <span className="inline-block w-1 h-3 sm:h-3.5 ml-1 bg-emerald-500 animate-pulse align-middle" />}
                  </span>
                  <div ref={captionsEndRef} />
                </div>
                
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>

      {/* ── MODERN FLOATING CONTROL DOCK ── */}
      <div className="absolute bottom-4 sm:bottom-6 left-0 w-full flex justify-center z-30 pointer-events-none px-2">
        <div className="flex items-center gap-2 sm:gap-3 pointer-events-auto max-w-full overflow-x-auto hide-scrollbar touch-pan-x px-2">
          
          <ControlButton icon={Icons.Question} active={showQuestion} onClick={() => setShowQuestion(!showQuestion)} title="Toggle Question" />
          <ControlButton icon={Icons.Captions} active={showCaptions} onClick={() => setShowCaptions(!showCaptions)} title="Toggle Captions" />
          <ControlButton icon={Icons.Chat} active={showTextInput} onClick={() => setShowTextInput(!showTextInput)} title="Toggle Chat" />

          {/* MIC FIRST */}
          <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: 'var(--mic-size, 44px)', height: 'var(--mic-size, 44px)' }}>
            <button onClick={() => setIsMicOn(!isMicOn)} disabled={!!micError} className={`w-full h-full relative z-10 rounded-full flex items-center justify-center transition-all shadow-lg ${isMicOn && !micError ? "bg-[#27272a] text-white border border-white/10" : "bg-[#dc2626] text-white border border-red-500 disabled:opacity-50"}`} title="Toggle Mic">
              {isMicOn && !micError ? <Icons.MicOn /> : <Icons.MicOff />}
            </button>
          </div>

          {/* CAMERA SECOND */}
          <ControlButton icon={isCamOn ? Icons.CamOn : Icons.CamOff} color="danger" active={isCamOn} onClick={() => setIsCamOn(!isCamOn)} title="Toggle Camera" />

          {/* ACTIONS */}
          <ControlButton icon={Icons.Interrupt} color="default" active={false} onClick={handleInterrupt} title="Interrupt" />
          <ControlButton icon={Icons.EndCall} color="end" onClick={() => router.push(`/results/${sessionId}`)} title="End Call" />

        </div>
      </div>

      <style jsx global>{`
        @media (max-width: 639px) { :root { --mic-size: 44px; } }
        @media (min-width: 640px) { :root { --mic-size: 48px; } }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </main>
  );
}

export default function InterviewRoomPage() {
  return <InterviewErrorBoundary><InterviewRoomInner /></InterviewErrorBoundary>;
}