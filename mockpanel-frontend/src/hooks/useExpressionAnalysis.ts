// hooks/useExpressionAnalysis.ts
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION FIXES:
//   1. ONLY runs analysis when videoRef.current is non-null
//      (caller passes null ref when camera is off — zero wasted processing)
//   2. Separate useEffect for init vs analysis loop — no unnecessary re-inits
//   3. Interval is properly cleared when camera turns off mid-session
//   4. Error is caught and logged — never crashes the interview room
//   5. sendJson is stable (useCallback in parent) — not in dep array
// ════════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const ANALYSIS_INTERVAL_MS = 1000;   // Run once per second — low CPU cost

export function useExpressionAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sendJson?: (payload: Record<string, unknown>) => void,
) {
  const [currentEmotion, setCurrentEmotion] = useState<string>("Neutral");
  const [isReady,        setIsReady]        = useState(false);

  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const sendJsonRef       = useRef(sendJson);

  // Keep sendJson ref current without adding it to effect dependencies
  useEffect(() => { sendJsonRef.current = sendJson; }, [sendJson]);

  // ── 1. Initialize MediaPipe ONCE on mount ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          outputFaceBlendshapes: true,
          runningMode:           "VIDEO",
          numFaces:              1,
        });

        if (!cancelled) {
          faceLandmarkerRef.current = landmarker;
          setIsReady(true);
          console.log("🎭 Expression AI ready");
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("⚠️ MediaPipe init failed (non-fatal):", err);
          // isReady stays false — expression overlay simply won't show
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
    };
  }, []); // ← empty — runs exactly once

  // ── 2. Analysis loop — runs ONLY when ready AND videoRef is non-null ─────────
  useEffect(() => {
    // FIX: If caller passes null ref (camera off), don't even start the interval
    if (!isReady || !videoRef.current) return;

    const intervalId = setInterval(() => {
      const video = videoRef.current;
      const lm    = faceLandmarkerRef.current;

      // Double-check inside interval — camera may have turned off mid-session
      if (!video || !lm || video.readyState < 2) return;

      try {
        const results = lm.detectForVideo(video, performance.now());

        if (!results?.faceBlendshapes?.length) return;

        const shapes        = results.faceBlendshapes[0].categories;
        const smileScore    = shapes.find(s => s.categoryName === "jawOpen")?.score      ?? 0;
        const browDown      = shapes.find(s => s.categoryName === "browDownLeft")?.score  ?? 0;
        const browInnerUp   = shapes.find(s => s.categoryName === "browInnerUp")?.score   ?? 0;
        const eyeSquint     = shapes.find(s => s.categoryName === "eyeSquintLeft")?.score ?? 0;

        let emotion = "Neutral";
        if      (smileScore > 0.5)  emotion = "Confident";
        else if (browDown   > 0.6)  emotion = "Intense";
        else if (browInnerUp > 0.4) emotion = "Focused";
        else if (eyeSquint   > 0.5) emotion = "Concentrating";

        setCurrentEmotion(emotion);

        // Send telemetry — use ref so this closure never goes stale
        sendJsonRef.current?.({
          type:       "telemetry",
          timestamp:  Date.now(),
          emotion,
          confidence: Math.max(smileScore, browDown, browInnerUp),
        });

      } catch (err) {
        // Silent — never crash the interview room over expression analysis
        console.debug("Expression analysis tick error:", err);
      }
    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(intervalId);

  }, [isReady, videoRef]); // re-runs when videoRef changes (cam on/off)

  return { currentEmotion, isReady };
}