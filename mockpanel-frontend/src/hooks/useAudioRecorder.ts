// hooks/useAudioRecorder.ts
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION v18.0 — NLP KEYWORD BARGE-IN (NO MORE ACCIDENTAL CUT-OFFS)
//
// FIXES & UPDATES:
//   [VAD FIX] Removed pure volume-based interruption. Laptop speakers were 
//             causing an "echo loop" which falsely triggered the AI to stop.
//   [NLP INTERRUPT] The AI will now ONLY stop if you explicitly say "Stop", 
//                   "Wait", "Excuse me", "Okay", or "Ruko". 
//   [ECHO REJECTION] While the AI is speaking, random noise and echo are ignored
//                    so the question can finish completely without breaking flow.
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

const SILENCE_TIMEOUT_MS     = 2500; // 2.5s gives you time to think
const RECOGNITION_RESTART_MS = 50;   

// Keywords that will actually stop the AI
const INTERRUPT_KEYWORDS = ["stop", "wait", "hold on", "excuse me", "okay", "ok", "one second", "ruko"];

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

  // Sync refs with state
  useEffect(() => { isAudioPlayingRef.current = isAudioPlaying; }, [isAudioPlaying]);
  useEffect(() => { onInterruptRef.current    = onInterrupt;    }, [onInterrupt]);
  useEffect(() => { onInterimRef.current      = onInterim;      }, [onInterim]);
  useEffect(() => { onFinalRef.current        = onFinal;        }, [onFinal]);
  useEffect(() => { enabledRef.current        = enabled;        }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {} 
        recognitionRef.current = null;
      }
      if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
      setIsRecording(false);
      setStream(null);
      return;
    }

    let cancelled = false;
    
    // Setup basic Mic stream just for the UI visualizer (Volume calculation removed)
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        setStream(s);
      })
      .catch(() => {
        if (!cancelled) setMicError("Microphone access denied. Please allow mic access.");
      });

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setMicError("Web Speech API not supported. Please use Google Chrome.");
      return;
    }

    const startRecognition = (lang = "en-IN") => {
      if (cancelled || !enabledRef.current) return;

      const recognition = new SpeechRecognition();
      recognition.continuous      = true;
      recognition.interimResults  = true;
      recognition.maxAlternatives = 1; 
      recognition.lang            = lang;
      recognitionRef.current      = recognition;

      const flushFinalText = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
        latestInterimRef.current = "";
        onFinalRef.current?.(trimmed);           
        sendJson({ type: "text", text: trimmed }); 
      };

      recognition.onstart = () => { if (!cancelled) setIsRecording(true); };

      recognition.onresult = (event: any) => {
        if (cancelled) return;

        let interimText = "";
        let finalText   = "";

        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
          else interimText += event.results[i][0].transcript;
        }

        const currentSpoken = (finalText || interimText).toLowerCase();

        // ── MAGIC FIX: NLP SMART INTERRUPT & ECHO REJECTION ──
        if (isAudioPlayingRef.current) {
            // Check if user spoke a designated interrupt word
            const isInterruptWord = INTERRUPT_KEYWORDS.some(kw => currentSpoken.includes(kw));
            
            if (isInterruptWord && !bargeInFiredRef.current) {
                bargeInFiredRef.current = true;
                onInterruptRef.current?.();
                setTimeout(() => { bargeInFiredRef.current = false; }, 2000);
                try { recognition.stop(); } catch (_) {}
            }
            // Ignore all other text while AI is speaking (Prevents echo from bleeding into script)
            return; 
        }

        // ── NORMAL PROCESSING (When AI is quiet) ──
        if (finalText.trim()) {
          flushFinalText(finalText);
          try { recognition.stop(); } catch (_) {}
          return;
        }

        if (interimText.trim()) {
          latestInterimRef.current = interimText;
          onInterimRef.current?.(interimText.trim()); 

          if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
          interimTimeoutRef.current = setTimeout(() => {
            const pending = latestInterimRef.current.trim();
            if (pending) {
              flushFinalText(pending);
              try { recognition.stop(); } catch (_) {}
            }
          }, SILENCE_TIMEOUT_MS); 
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error === "language-not-supported") {
          try { recognition.abort(); } catch (_) {}
          setTimeout(() => startRecognition("en-US"), 100);
          return;
        }
      };

      recognition.onend = () => {
        if (cancelled || !enabledRef.current) { setIsRecording(false); return; }
        setTimeout(() => {
          if (!cancelled && enabledRef.current) {
            try { recognition.start(); } catch (_) {}
          }
        }, RECOGNITION_RESTART_MS);
      };

      try { recognition.start(); } catch (e) {}
    };

    startRecognition("en-IN"); 

    return () => {
      cancelled = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {} 
        recognitionRef.current = null;
      }
      if (interimTimeoutRef.current) clearTimeout(interimTimeoutRef.current);
      setIsRecording(false);
      setStream(null);
    };
  }, [enabled, sendJson]);

  return { isRecording, micError, stream };
}