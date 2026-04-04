// hooks/useAudioRecorder.ts
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION FIXES:
//   [REC-1]  FileReader-based blobToBase64 — zero data corruption on binary audio.
//            Replaces broken uint8ArrayToBase64 (String.fromCharCode mangled
//            bytes > 127 through UTF-16; btoa then mis-encoded them).
//   [REC-2]  Safari/iOS MIME type fallback: prefers audio/webm;codecs=opus,
//            falls back to audio/mp4. Sent as mimeType field with every chunk.
//   [REC-3]  `enabled` prop — mic start/stop controlled externally (e.g. when
//            permission is denied, or interview hasn't started yet).
//   [REC-4]  `isAudioPlaying` prop — VAD suppressed while AI speaks, so AI
//            voice is never re-recorded and sent back to Deepgram (echo loop).
//   [REC-5]  Exposes `stream` so the caller can reuse it for volume visualization
//            without opening a second getUserMedia handle.
//   [REC-6]  Atomic chunk snapshot in onstop — prevents new recording data from
//            mixing into the blob being encoded.
//   [REC-7]  MIN_BLOB_SIZE guard — discards breath noise / mic-click artifacts.
//   [REC-8]  `micError` state surfaces permission-denied errors to UI.
//   [REC-9]  AudioContext closed on cleanup — no "too many AudioContexts" warning.
// ════════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD = 12;    // average frequency amplitude below = silence
const SILENCE_DURATION  = 2500;  // ms of silence before sending utterance
const MIN_BLOB_SIZE     = 500;   // bytes — discard breath-noise bursts below this

type SendJson = (payload: Record<string, unknown>) => void;

export interface UseAudioRecorderOptions {
  /** When true, recording is active. When false, mic is stopped and cleaned up. */
  enabled: boolean;
  /** When true, VAD is suppressed so AI voice is not re-recorded. */
  isAudioPlaying: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * [REC-1] Converts a Blob to base64 using the browser's native FileReader.
 *
 * WHY NOT btoa(String.fromCharCode(...)):
 *   JS strings are UTF-16. For bytes > 127 (extremely common in WebM/Opus),
 *   fromCharCode() creates multi-byte sequences. btoa() then encodes those
 *   differently from the original bytes.
 *   Example: WebM magic byte 0xDF → fromCharCode → U+00DF → btoa → "w98="
 *   Correct encoding should be "3w==". Deepgram sees corrupt EBML header → 400.
 *
 *   FileReader.readAsDataURL() operates at the OS/browser binary level, bypassing
 *   JS string encoding entirely → guaranteed correct base64 output.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Format: "data:audio/webm;base64,ACTUAL_DATA_HERE"
      const base64 = result.split(",")[1];
      if (base64) resolve(base64);
      else reject(new Error("[AudioRecorder] FileReader returned empty base64"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("[AudioRecorder] FileReader error"));
    reader.readAsDataURL(blob);
  });
}

/**
 * [REC-2] Picks the best supported MIME type for MediaRecorder.
 * Chrome/Firefox → audio/webm;codecs=opus
 * Safari/iOS     → audio/mp4
 */
function getSupportedMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ""; // let browser decide as last resort
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioRecorder(
  sendJson: SendJson,
  { enabled, isAudioPlaying }: UseAudioRecorderOptions,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [micError,    setMicError]    = useState<string | null>(null);
  // [REC-5] Expose stream so caller can pass it to a volume visualizer
  // without requesting a second getUserMedia handle
  const [stream,      setStream]      = useState<MediaStream | null>(null);

  const streamRef        = useRef<MediaStream | null>(null);
  const audioContextRef  = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const silenceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef     = useRef<number>(0);
  const isSpeakingRef    = useRef(false);
  const chunksRef        = useRef<Blob[]>([]);
  // [REC-4] Ref copy — avoids closure staleness in the rAF loop
  const isPlayingRef     = useRef(isAudioPlaying);
  useEffect(() => { isPlayingRef.current = isAudioPlaying; }, [isAudioPlaying]);

  // ── Teardown ──────────────────────────────────────────────────────────────
  const stopEverything = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (mediaRecorderRef.current?.state !== "inactive") {
      try { mediaRecorderRef.current?.stop(); } catch (_) {}
    }
    mediaRecorderRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // [REC-9] Release AudioContext to avoid memory leak
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;

    isSpeakingRef.current = false;
    chunksRef.current     = [];
    setIsRecording(false);
    setStream(null);
  }, []);

  // ── Main effect ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) { stopEverything(); return; }

    let cancelled = false;

    (async () => {
      try {
        setMicError(null);

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
            sampleRate:       16000,
          },
        });

        if (cancelled) {
          mediaStream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = mediaStream;
        setStream(mediaStream); // [REC-5]

        // VAD analyser
        const AudioCtx = window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        const analyser = audioCtx.createAnalyser();
        audioCtx.createMediaStreamSource(mediaStream).connect(analyser);
        analyser.fftSize = 256;
        audioContextRef.current = audioCtx;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const mimeType  = getSupportedMimeType();
        const blobType  = mimeType || "audio/webm"; // [REC-2] label for backend

        setIsRecording(true);

        const finishAndSend = () => {
          if (mediaRecorderRef.current?.state === "recording") {
            try { mediaRecorderRef.current.stop(); } catch (_) {}
          }
        };

        const startNewRecorder = () => {
          if (mediaRecorderRef.current?.state === "recording") return;
          chunksRef.current = [];

          const recorderOptions = mimeType ? { mimeType } : {};
          const recorder        = new MediaRecorder(mediaStream, recorderOptions);
          mediaRecorderRef.current = recorder;

          recorder.ondataavailable = (e) => {
            if (e.data?.size > 0) chunksRef.current.push(e.data);
          };

          // [REC-1] + [REC-6]: atomic snapshot before async encode
          recorder.onstop = async () => {
            const snapshot    = [...chunksRef.current]; // atomic copy
            chunksRef.current = [];                     // clear ref immediately

            if (snapshot.length === 0) return;

            const blob = new Blob(snapshot, { type: blobType });
            if (blob.size < MIN_BLOB_SIZE) return; // [REC-7] discard noise

            try {
              const base64 = await blobToBase64(blob);
              sendJson({
                type:     "audio_chunk",
                data:     base64,
                mimeType: blobType, // [REC-2] hint for backend content-type detection
              });
              // 80ms delay ensures audio_chunk arrives before speech_end
              setTimeout(() => sendJson({ type: "speech_end" }), 80);
            } catch (err) {
              console.error("[AudioRecorder] blobToBase64 failed:", err);
            }
          };

          recorder.start(250); // collect data every 250ms
        };

        // ── VAD loop ─────────────────────────────────────────────────────────
        const checkAudioLevel = () => {
          if (cancelled) return;

          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const volume = sum / dataArray.length;

          if (!isPlayingRef.current) {
            // [REC-4] AI is silent — listen for user speech
            if (volume > SILENCE_THRESHOLD) {
              if (!isSpeakingRef.current) {
                isSpeakingRef.current = true;
                startNewRecorder();
              }
              if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
              }
            } else {
              if (isSpeakingRef.current && !silenceTimerRef.current) {
                silenceTimerRef.current = setTimeout(() => {
                  isSpeakingRef.current   = false;
                  silenceTimerRef.current = null;
                  finishAndSend();
                }, SILENCE_DURATION);
              }
            }
          } else {
            // [REC-4] AI is speaking — discard captured audio (echo suppression)
            if (isSpeakingRef.current) {
              if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
              isSpeakingRef.current   = false;
              try { mediaRecorderRef.current?.stop(); } catch (_) {}
              chunksRef.current = []; // discard: never echo AI's voice back
            }
          }

          animFrameRef.current = requestAnimationFrame(checkAudioLevel);
        };

        checkAudioLevel();

      } catch (err) {
        if (!cancelled) {
          const isDenied =
            err instanceof DOMException && err.name === "NotAllowedError";
          setMicError(
            isDenied
              ? "Microphone permission denied. Please allow access and try again."
              : "Could not access microphone. Check your device settings.",
          );
          setIsRecording(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopEverything();
    };
  }, [enabled, sendJson, stopEverything]);

  return { isRecording, micError, stream };
}