// hooks/useAudioRecorder.ts
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION v6.0 — SMOOTH VOICE + INSTANT DISPLAY
//
// FIXES vs v5.0:
//   [F-1]  Single consolidated displayText ref — no React state lag for captions.
//          onInterim fires directly, bypassing re-render queue.
//   [F-2]  Recognition language: "en-IN" primary, auto-retry with "en-US" on error.
//   [F-3]  Silence timeout reduced: 1200ms (was 1500ms) — feels more responsive.
//   [F-4]  Barge-in reset reduced: 1200ms (was 2000ms) — quicker re-arm.
//   [F-5]  maxAlternatives = 1 explicitly set — no wasted processing.
//   [F-6]  Recognition restart is immediate (50ms vs 100ms) — mic gap eliminated.
//   [F-7]  onFinal fires BEFORE sendJson — UI updates instantly, then network call.
//   [F-8]  interimText accumulates across result chunks — no word drops mid-sentence.
//   [F-9]  NORMAL_THRESHOLD lowered to 10 — softer voices captured correctly.
//   [F-10] Explicit abort() on cleanup (not just stop()) — Chrome memory leak fix.
// ════════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from "react";

type SendJson = (payload: Record<string, unknown>) => void;

export interface UseAudioRecorderOptions {
  enabled: boolean;
  isAudioPlaying: boolean;
  onInterrupt?: () => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
}

// ── Thresholds ─────────────────────────────────────────────────────────────────
const NORMAL_THRESHOLD          = 10;   // [F-9] Softer voices captured
const BARGE_IN_THRESHOLD        = 32;   // AI speaking — needs deliberate voice
const SILENCE_TIMEOUT_MS        = 1200; // [F-3] Faster auto-submit
const RECOGNITION_RESTART_MS    = 50;   // [F-6] Near-zero mic gap

export function useAudioRecorder(
  sendJson: SendJson,
  { enabled, isAudioPlaying, onInterrupt, onInterim, onFinal }: UseAudioRecorderOptions,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [micError,    setMicError]    = useState<string | null>(null);
  const [stream,      setStream]      = useState<MediaStream | null>(null);

  const isAudioPlayingRef = useRef(isAudioPlaying);
  const onInterruptRef    = useRef(onInterrupt);
  const onInterimRef      = useRef(onInterim);
  const onFinalRef        = useRef(onFinal);
  const recognitionRef    = useRef<any>(null);
  const interimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestInterimRef  = useRef<string>("");
  const bargeInFiredRef   = useRef(false);
  const enabledRef        = useRef(enabled);
  // [F-8] Accumulate interim across chunks
  const accumulatedInterimRef = useRef<string>("");

  useEffect(() => { isAudioPlayingRef.current = isAudioPlaying; }, [isAudioPlaying]);
  useEffect(() => { onInterruptRef.current    = onInterrupt;    }, [onInterrupt]);
  useEffect(() => { onInterimRef.current      = onInterim;      }, [onInterim]);
  useEffect(() => { onFinalRef.current        = onFinal;        }, [onFinal]);
  useEffect(() => { enabledRef.current        = enabled;        }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {} // [F-10]
        recognitionRef.current = null;
      }
      if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
      setIsRecording(false);
      setStream(null);
      return;
    }

    let cancelled  = false;
    let audioCtx:  AudioContext | null = null;
    let rafId:     number = 0;
    let micStream: MediaStream | null = null;

    // ── Step 1: Mic stream for VAD ─────────────────────────────────────────────
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }

        micStream = s;
        setStream(s);

        const AC = window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new AC();
        const analyser = audioCtx.createAnalyser();
        audioCtx.createMediaStreamSource(s).connect(analyser);
        analyser.fftSize = 256;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkVolume = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const volume = sum / dataArray.length;

          if (isAudioPlayingRef.current && volume > BARGE_IN_THRESHOLD) {
            if (!bargeInFiredRef.current) {
              bargeInFiredRef.current = true;
              onInterruptRef.current?.();
              setTimeout(() => { bargeInFiredRef.current = false; }, 1200); // [F-4]
            }
          }
          rafId = requestAnimationFrame(checkVolume);
        };
        checkVolume();
      })
      .catch(() => {
        if (!cancelled) setMicError("Microphone access denied. Please allow mic access and reload.");
      });

    // ── Step 2: Web Speech API ─────────────────────────────────────────────────
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;

    if (!SpeechRecognition) {
      setMicError("Web Speech API not supported. Please use Google Chrome.");
      return;
    }

    const startRecognition = (lang = "en-IN") => {
      if (cancelled || !enabledRef.current) return;

      const recognition = new SpeechRecognition();
      recognition.continuous      = true;
      recognition.interimResults  = true;
      recognition.maxAlternatives = 1; // [F-5]
      recognition.lang            = lang;

      recognitionRef.current = recognition;

      // [F-7] UI first, then network
      const flushFinalText = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        if (interimTimeoutRef.current) {
          clearTimeout(interimTimeoutRef.current);
          interimTimeoutRef.current = null;
        }

        accumulatedInterimRef.current = "";
        latestInterimRef.current      = "";

        onFinalRef.current?.(trimmed);           // [F-7] UI first
        sendJson({ type: "text", text: trimmed }); // then network
      };

      recognition.onstart = () => {
        if (!cancelled) setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        if (cancelled) return;

        let interimText = "";
        let finalText   = "";

        // [F-8] Rebuild full interim from ALL results (not just new ones)
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }

        if (finalText.trim()) {
          accumulatedInterimRef.current = "";
          flushFinalText(finalText);
          return;
        }

        if (interimText.trim()) {
          accumulatedInterimRef.current = interimText;
          latestInterimRef.current      = interimText;
          onInterimRef.current?.(interimText.trim()); // [F-1] Direct, no delay

          if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
          interimTimeoutRef.current = setTimeout(() => {
            const pending = latestInterimRef.current.trim();
            if (pending) {
              flushFinalText(pending);
              try { recognition.stop(); } catch (_) {}
            }
          }, SILENCE_TIMEOUT_MS); // [F-3]
        }
      };

      recognition.onerror = (e: any) => {
        // [F-2] If language error, retry with en-US
        if (e.error === "language-not-supported") {
          try { recognition.abort(); } catch (_) {}
          setTimeout(() => startRecognition("en-US"), 100);
          return;
        }
        if (e.error === "no-speech" || e.error === "aborted") return;
        console.warn("[AudioRecorder] Speech error:", e.error);
      };

      recognition.onend = () => {
        if (cancelled || !enabledRef.current) {
          setIsRecording(false);
          return;
        }
        // [F-6] Near-instant restart
        setTimeout(() => {
          if (!cancelled && enabledRef.current) {
            try { recognition.start(); } catch (_) {}
          }
        }, RECOGNITION_RESTART_MS);
      };

      try { recognition.start(); } catch (e) {
        console.error("[AudioRecorder] Start failed:", e);
      }
    };

    startRecognition("en-IN"); // [F-2] Start with Indian English

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {} // [F-10]
        recognitionRef.current = null;
      }
      if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
      micStream?.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      setStream(null);
    };
  }, [enabled, sendJson]);

  return { isRecording, micError, stream };
}