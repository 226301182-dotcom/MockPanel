// hooks/useWebSocket.ts
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION FIXES:
//   [WS-1]  Auto-reconnect with exponential backoff (max 5 attempts).
//           Does NOT reconnect on code 1000 (intentional close) or
//           1008 (unauthorized) — avoids infinite retry loops.
//   [WS-2]  "closed_unauthorized" status emitted on close code 1008.
//           Page can redirect to login without polling or guessing.
//   [WS-3]  AudioContext created ONCE per hook instance — reused for all chunks.
//           Prevents "too many AudioContexts" warning after repeated connects.
//   [WS-4]  isAudioPlaying uses an accurate counter (activeSourceCount).
//           Never false-positives or false-negatives when chunks overlap.
//   [WS-5]  Safe base64 decoder — returns null instead of throwing on invalid
//           input. Protects against malformed chunks crashing the decode queue.
//   [WS-6]  processDecodeQueue is fully sequential — isDecoding lock prevents
//           overlapping decode calls.
//   [WS-7]  stopAudio resets isDecoding lock — stuck queue after interrupt fixed.
//   [WS-8]  sendJson returns false silently when WS is not open (no throw).
// ════════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

export type WsStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "closed_unauthorized" // [WS-2] close code 1008 from backend
  | "error";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_UI_MESSAGES     = 200;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]; // ~5 attempts
const SAFETY_BUFFER_S     = 0.15; // 150ms schedule-ahead for audio chunks

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * [WS-5] Decodes a base64 string to Uint8Array.
 * Returns null instead of throwing so invalid chunks are silently skipped.
 */
function safeBase64ToUint8Array(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (e) {
    console.warn("[WebSocket] Invalid base64 audio chunk — skipped:", e);
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWebSocket(
  url: string | null,
  token: string | null = null,
  onMessage?: (msg: WsMessage) => void,
) {
  const [status,         setStatus]         = useState<WsStatus>("idle");
  const [messages,       setMessages]       = useState<WsMessage[]>([]);
  const [streamingText,  setStreamingText]  = useState<string>("");
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);

  const wsRef        = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  // ── Reconnect state ───────────────────────────────────────────────────────
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef  = useRef(true);

  // ── Audio engine (single instance per hook) ───────────────────────────────
  // [WS-3] AudioContext lives for the lifetime of the hook, not per-chunk
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const nextStartTimeRef  = useRef<number>(0);
  const sourceNodesRef    = useRef<AudioBufferSourceNode[]>([]);
  const decodeQueue       = useRef<string[]>([]);
  const isDecoding        = useRef(false);
  const activeSourceCount = useRef(0); // [WS-4] counter for accurate play state

  // ── ws→wss upgrade on HTTPS pages ────────────────────────────────────────
  const resolvedUrl = useMemo(() => {
    if (!url) return null;
    if (typeof window === "undefined") return url;
    if (url.startsWith("ws://") && window.location.protocol === "https:") {
      return url.replace("ws://", "wss://");
    }
    return url;
  }, [url]);

  // ── Audio: stop all playback ──────────────────────────────────────────────
  const stopAudio = useCallback(() => {
    decodeQueue.current = [];
    isDecoding.current  = false; // [WS-7] reset lock so queue doesn't stay stuck

    sourceNodesRef.current.forEach((src) => {
      try { src.stop(); src.disconnect(); } catch (_) {}
    });
    sourceNodesRef.current    = [];
    nextStartTimeRef.current  = 0;
    activeSourceCount.current = 0;
    setIsAudioPlaying(false);
  }, []);

  // ── Audio: decode and schedule chunks sequentially ────────────────────────
  const processDecodeQueue = useCallback(async () => {
    if (isDecoding.current || decodeQueue.current.length === 0) return;
    isDecoding.current = true;

    try {
      // [WS-3] Lazy-init (must be after a user gesture for iOS)
      if (!audioCtxRef.current) {
        const AC = window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AC();
      }

      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      while (decodeQueue.current.length > 0) {
        const b64Audio = decodeQueue.current.shift()!;

        const bytes = safeBase64ToUint8Array(b64Audio); // [WS-5]
        if (!bytes || bytes.length === 0) continue;

        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
        } catch (err) {
          console.error("[WebSocket] decodeAudioData error:", err);
          continue;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // [WS-4] Schedule with safety buffer to prevent chunk gaps
        const currentTime = ctx.currentTime;
        let startTime     = nextStartTimeRef.current;
        if (startTime < currentTime + SAFETY_BUFFER_S) {
          startTime = currentTime + SAFETY_BUFFER_S;
        }

        source.start(startTime);
        sourceNodesRef.current.push(source);
        activeSourceCount.current += 1;
        setIsAudioPlaying(true);

        nextStartTimeRef.current = startTime + audioBuffer.duration;

        source.onended = () => {
          sourceNodesRef.current = sourceNodesRef.current.filter(n => n !== source);
          activeSourceCount.current = Math.max(0, activeSourceCount.current - 1);
          if (activeSourceCount.current === 0) setIsAudioPlaying(false);
        };
      }
    } finally {
      isDecoding.current = false;
    }
  }, []);

  // ── Audio: enqueue a new chunk ────────────────────────────────────────────
  const enqueueAudioChunk = useCallback((b64Audio: unknown) => {
    if (typeof b64Audio !== "string" || b64Audio.length === 0) {
      console.warn("[WebSocket] enqueueAudioChunk: invalid value — skipped");
      return;
    }
    decodeQueue.current.push(b64Audio);
    processDecodeQueue();
  }, [processDecodeQueue]);

  // ── Message dispatcher ────────────────────────────────────────────────────
  const handleMessage = useCallback((data: WsMessage) => {
    if (!data || typeof data.type !== "string") {
      console.warn("[WebSocket] Message missing type field — skipped:", data);
      return;
    }

    if (data.type === "audio_chunk") {
      enqueueAudioChunk(data.audio);
      return; // don't add raw audio blobs to UI message list
    }

    if (data.type === "ai_text_chunk" || data.type === "response_chunk") {
      setStreamingText(prev => prev + ((data.text as string) ?? ""));
    } else if (data.type === "response_complete") {
      setStreamingText("");
    }

    setMessages(prev => {
      const next = [...prev, data];
      return next.length > MAX_UI_MESSAGES ? next.slice(-MAX_UI_MESSAGES) : next;
    });
  }, [enqueueAudioChunk]);

  // ── WebSocket: connect (also used for reconnect) ──────────────────────────
  const connect = useCallback(() => {
    if (!resolvedUrl) return;

    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    const wsUrl = token
      ? `${resolvedUrl}?token=${encodeURIComponent(token)}`
      : resolvedUrl;

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error("[WebSocket] Init failed:", err);
      setStatus("error");
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setStatus("connected");
    };

    ws.onclose = (evt) => {
      wsRef.current = null;

      // [WS-2] 1008 = unauthorized — redirect to login, never retry
      if (evt.code === 1008) {
        setStatus("closed_unauthorized");
        return;
      }

      // [WS-1] Reconnect on unexpected closes (not 1000 = intentional)
      if (shouldReconnectRef.current && evt.code !== 1000) {
        const attempt = reconnectAttemptRef.current;
        if (attempt < RECONNECT_DELAYS_MS.length) {
          reconnectAttemptRef.current = attempt + 1;
          const delay = RECONNECT_DELAYS_MS[attempt];
          console.info(
            `[WebSocket] Reconnecting in ${delay}ms (attempt ${attempt + 1})…`,
          );
          reconnectTimerRef.current = setTimeout(connect, delay);
        } else {
          console.error("[WebSocket] Max reconnect attempts reached.");
          setStatus("error");
        }
      } else {
        setStatus("closed");
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — let onclose handle everything
    };

    ws.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data) as WsMessage;
        handleMessage(parsed);
        onMessageRef.current?.(parsed);
      } catch (e) {
        console.error("[WebSocket] JSON parse error:", e);
      }
    };
  }, [resolvedUrl, token, handleMessage]);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!resolvedUrl) return;
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close(1000, "unmount");
      wsRef.current = null;
      stopAudio();
      // [WS-3] Close shared AudioContext on unmount
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setStatus("closed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedUrl, token]);

  // ── [WS-8] Safe sendJson ──────────────────────────────────────────────────
  const sendJson = useCallback((payload: Record<string, unknown>): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  return {
    status,
    messages,
    streamingText,
    sendJson,
    stopAudio,
    isAudioPlaying,
    clearMessages:  useCallback(() => setMessages([]), []),
    isConnected:    status === "connected",
    isReconnecting: status === "reconnecting",
  };
}