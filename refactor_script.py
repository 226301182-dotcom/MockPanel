import os

# 📂 Define the directory structure and file contents
FILES = {
    # ==========================================
    # FRONTEND: HOOKS
    # ==========================================
    "mockpanel-frontend/src/hooks/useWebSocket.ts": """import { useEffect, useMemo, useRef, useState } from "react";

type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export function useWebSocket(url: string | null, token: string | null = null) {
  const [status, setStatus] = useState<WsStatus>("idle");
  const [messages, setMessages] = useState<any[]>([]);
  const [streamingText, setStreamingText] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);

  // 🚀 AUDIO QUEUE SYSTEM (Prevents AI from talking over itself)
  const audioQueue = useRef<string[]>([]);
  const isPlaying = useRef(false);

  const playNextAudio = () => {
    if (audioQueue.current.length === 0) {
      isPlaying.current = false;
      return;
    }
    isPlaying.current = true;
    const nextAudioUrl = audioQueue.current.shift();
    
    if (nextAudioUrl) {
      const audio = new Audio(nextAudioUrl);
      audio.volume = 0.8;
      audio.onended = () => {
        URL.revokeObjectURL(nextAudioUrl); // Clear memory
        playNextAudio(); // Play next chunk in line
      };
      audio.play().catch(err => {
        console.error("Audio chunk play failed:", err);
        playNextAudio(); // Skip to next if fails
      });
    }
  };

  const canConnect = useMemo(() => Boolean(url), [url]);

  useEffect(() => {
    if (!canConnect || !url) return;

    setStatus("connecting");
    // 🚀 BUG FIX: Pass token in URL query string.
    const wsUrl = token ? `${url}?token=${token}` : url;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        setMessages(prev => [...prev, data]);
        
        if (data.type === "response_chunk") {
          setStreamingText(prev => prev + data.text);
        } else if (data.type === "response_complete") {
          setStreamingText(""); 
        } else if (data.type === "audio_chunk") {
          // 🚀 Convert to Blob and push to Queue
          const audioBlob = new Blob(
            [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))], 
            { type: "audio/mpeg" }
          );
          const audioUrl = URL.createObjectURL(audioBlob);
          audioQueue.current.push(audioUrl);
          
          if (!isPlaying.current) {
            playNextAudio();
          }
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setStatus("closed");
      // Stop audio on unmount
      audioQueue.current = [];
      isPlaying.current = false;
    };
  }, [canConnect, url, token]);

  function sendJson(payload: unknown) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  return { status, messages, streamingText, sendJson };
}
""",

    "mockpanel-frontend/src/hooks/useExpressionAnalysis.ts": """import { useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export const useExpressionAnalysis = (
  videoRef: React.RefObject<HTMLVideoElement | null>,
  sendJson?: (payload: any) => void
) => {
  const [currentEmotion, setCurrentEmotion] = useState<string>("Neutral");
  const [isReady, setIsReady] = useState(false);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    let isMounted = true; // 🚀 BUG FIX: Memory leak prevention

    const initializeAI = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1
        });

        if (isMounted) {
          faceLandmarkerRef.current = landmarker;
          setIsReady(true);
          console.log("🎭 Expression AI Loaded & Ready!");
        }
      } catch (error) {
        console.error("Failed to initialize MediaPipe:", error);
      }
    };

    initializeAI();

    if (isReady && videoRef.current) {
      intervalId = setInterval(() => {
        if (videoRef.current && videoRef.current.readyState >= 2 && faceLandmarkerRef.current) {
          const timestampMs = performance.now();
          const results = faceLandmarkerRef.current.detectForVideo(videoRef.current, timestampMs);

          if (results?.faceBlendshapes && results.faceBlendshapes.length > 0) {
            const shapes = results.faceBlendshapes[0].categories;
            const smileScore = shapes.find(s => s.categoryName === "jawOpen")?.score || 0;
            const browDown = shapes.find(s => s.categoryName === "browDownLeft")?.score || 0;
            const browInnerUp = shapes.find(s => s.categoryName === "browInnerUp")?.score || 0;

            let emotion = "Neutral";
            if (smileScore > 0.5) emotion = "Happy / Confident";
            else if (browDown > 0.6) emotion = "Intense / Nervous";
            else if (browInnerUp > 0.4) emotion = "Surprised / Focused";

            setCurrentEmotion(emotion);

            if (sendJson) {
              sendJson({
                type: "telemetry",
                timestamp: Date.now(),
                emotion: emotion,
                confidence: Math.max(smileScore, browDown, browInnerUp)
              });
            }
          }
        }
      }, 1000); 
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      faceLandmarkerRef.current?.close();
    };
  }, [isReady, videoRef, sendJson]); 

  return { currentEmotion, isReady };
};
""",

    # ==========================================
    # BACKEND: API & WEBSOCKETS (Merged Logic)
    # ==========================================
    "mockpanel-backend/api/v1/websockets.py": """import logging
import uuid
import base64
import asyncio
import re
import httpx

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.llm_service import llm_service
from services.audio_service import AudioService
from services.avatar_service import avatar_service
from db.redis_client import redis_cache
from db.supabase_client import get_supabase_service_client
from prompts.sde_manager import SYSTEM_PROMPT as SDE_PROMPT
from prompts.upsc_board import SYSTEM_PROMPT as UPSC_PROMPT
from core.panel_config import PANEL_PROFILES
from core.config import settings
from workers.analytics_worker import enqueue_analytics_generation
from core.security import verify_token, get_client_ip, log_security_event

router = APIRouter(tags=["ws"])
logger = logging.getLogger("uvicorn")

# Global audio buffer for real-time transcription
audio_buffers: dict[str, list[bytes]] = {}

async def stream_tts_sentence(sentence: str, voice_id: str, ws: WebSocket):
    \"\"\"Background task to stream TTS for a sentence\"\"\"
    try:
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": settings.elevenlabs_api_key
        }

        data = {
            "text": sentence,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.5
            }
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers=headers,
                json=data
            )

            if response.status_code == 200:
                audio_data = response.content
                # Send audio chunk via WebSocket
                await ws.send_json({
                    "type": "audio_chunk",
                    "audio": base64.b64encode(audio_data).decode()
                })
    except Exception as e:
        logger.exception(f"TTS sentence failed: {e}")

def _domain_system_prompt(domain: str) -> str:
    d = (domain or "").lower()
    if d == "sde":
        return SDE_PROMPT
    if d in {"upsc", "uppsc"}:
        return UPSC_PROMPT
    return "You are an interviewer. Ask relevant questions."


def _build_prompt(system_prompt: str, messages: list[dict], *, next_user_message: str | None = None) -> str:
    parts: list[str] = [system_prompt]
    for msg in messages:
        role = "User" if msg.get("role") == "user" else "Assistant"
        parts.append(f"{role}: {msg.get('content', '')}")
    if next_user_message is not None:
        parts.append(f"User: {next_user_message}")
        parts.append("Assistant:")
    return \"\\n\\n\".join(parts)


@router.websocket("/ws/v1/interview/{session_id}")
async def interview_ws(
    ws: WebSocket, 
    session_id: str,
    token: str = Query(None) # 🚀 BUG FIX: Accept token as query parameter
):
    client_ip = get_client_ip(ws)
    user_id = "anonymous"

    try:
        # 🚀 Verify the token extracted from the query params
        if token:
            try:
                payload = verify_token(token)
                user_id = payload.get("sub", "anonymous")
            except Exception as e:
                logger.warning(f"Invalid token from {client_ip}: {e}")
                await ws.close(code=403)
                return
        else:
            # Fallback to header for compatibility
            auth_header = ws.headers.get("authorization") or ws.headers.get("Authorization")
            if auth_header and auth_header.lower().startswith("bearer "):
                token_h = auth_header.split(" ", 1)[1].strip()
                try:
                    payload = verify_token(token_h)
                    user_id = payload.get("sub", "anonymous")
                except Exception as e:
                    logger.warning(f"Invalid header token from {client_ip}: {e}")
                    await ws.close(code=403)
                    return
            else:
                logger.warning(f"No auth token from {client_ip}, allowing anonymous")
                user_id = "anonymous"

        await ws.accept()
        logger.info(f"WebSocket connected for session: {session_id}, user: {user_id}, ip: {client_ip}")
        await log_security_event("websocket_connect", user_id, {"session_id": session_id}, ws)

        # Initialize audio buffer for this session
        audio_buffers[session_id] = []

        client = get_supabase_service_client()
        if client is None:
            logger.error("Supabase service client not configured")
            await ws.close(code=500)
            return
        audio_service: AudioService | None = None

        # Validate session_id as UUID
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            logger.error(f"Invalid session_id format: {session_id}")
            await ws.close(code=400)
            return

        # Fetch session details
        result = client.table("interviews").select("*").eq("id", str(session_uuid)).execute()
        if not result.data:
            logger.error("Session not found")
            await ws.close(code=404)
            return

        session = result.data[0]
        domain = session.get("domain", "sde").lower()
        system_prompt = _domain_system_prompt(domain)

        # Set initial session state
        await redis_cache.set_session_state(session_id, "listening")

        # Try to get conversation history from Redis cache first
        conversation_history = await redis_cache.get_session_context(session_id)
        if conversation_history is None:
            # Fallback to database if not in cache
            history_result = client.table("interview_messages").select("*").eq("session_id", str(session_uuid)).order("created_at").execute()
            conversation_history = history_result.data if history_result.data else []
            # Cache it for future use
            await redis_cache.set_session_context(session_id, conversation_history)

        # If history exists, immediately hydrate UI with last assistant message
        if conversation_history:
            last_assistant = next(
                (m for m in reversed(conversation_history) if m.get("role") == \"assistant\" and m.get(\"content\")),
                None,
            )
            if last_assistant:
                await ws.send_json({"type": "question", "text": last_assistant["content"]})
        else:
            # If no history, generate and persist the first question
            opening_prompt = _build_prompt(
                system_prompt,
                [],
                next_user_message="Start the interview with the first question. Ask only one question.",
            )
            try:
                first_question = await asyncio.wait_for(
                    llm_service.generate_response(prompt=opening_prompt, domain=domain),
                    timeout=12,
                )
            except Exception as e:
                logger.exception("Failed to generate first question; using fallback")
                first_question = (
                    "Welcome. Please introduce yourself briefly and tell me why you chose this domain."
                )
            client.table("interview_messages").insert({
                "session_id": str(session_uuid),
                "role": "assistant",
                "content": first_question,
            }).execute()
            await ws.send_json({"type": "question", "text": first_question})
            conversation_history = [{"role": "assistant", "content": first_question}]
            # Cache the initial conversation
            await redis_cache.set_session_context(session_id, conversation_history)

        while True:
            try:
                data = await ws.receive_json()
                logger.info(f"Received JSON data")

                msg = ""
                msg_type = data.get("type")
                if msg_type == "telemetry":
                    # Handle expression analysis telemetry
                    emotion = data.get("emotion", "neutral")
                    timestamp = data.get("timestamp", 0)
                    confidence = data.get("confidence", 0.0)
                    # Store in Redis or database for analytics
                    await redis_cache.store_telemetry(session_id, {
                        "emotion": emotion,
                        "timestamp": timestamp,
                        "confidence": confidence
                    })
                    continue  # No response needed for telemetry
                elif msg_type in {"audio", "audio_chunk"}:
                    if audio_service is None:
                        audio_service = AudioService()
                    audio_b64 = data["data"]
                    audio_bytes = base64.b64decode(audio_b64)
                    try:
                        msg = await audio_service.stt_stream(audio_bytes)
                        logger.info(f"Transcribed message: {msg}")
                        await ws.send_json({"type": "transcript_final", "text": msg})
                        await ws.send_json({"type": "transcription", "text": msg})
                    except Exception as e:
                        logger.exception("STT failed")
                        await ws.send_json({"type": "error", "message": str(e)})
                        continue
                    msg = (msg or "").strip()
                    if not msg:
                        await ws.send_json(
                            {
                                "type": "error",
                                "message": "No speech detected (or unsupported audio format). Please try again.",
                            }
                        )
                        continue
                else:
                    msg = data.get("text", "")
                msg = (msg or "").strip()
                if not msg:
                    await ws.send_json({"type": "error", "message": "Empty message"})
                    continue

                # Save user message to database
                client.table("interview_messages").insert({
                    "session_id": str(session_uuid),
                    "role": "user",
                    "content": msg
                }).execute()

                # Update local history and generate assistant response
                conversation_history.append({"role": "user", "content": msg})
                # Update Redis cache with new conversation history
                await redis_cache.set_session_context(session_id, conversation_history)
                
                # Get panel profile for voice mapping
                panel_profile = PANEL_PROFILES.get(domain, PANEL_PROFILES["sde"])
                speaker_voices = {name: member["voice_id"] for name, member in panel_profile["members"].items()}
                
                # Set session state to thinking
                await redis_cache.set_session_state(session_id, "thinking")
                await ws.send_json({"type": "thinking", "status": True})
                prompt = _build_prompt(system_prompt, conversation_history, next_user_message=None)
                prompt = f"{prompt}\\n\\nAssistant:"
                
                # Stream the response with sentence-based TTS
                full_response = ""
                current_speaker = "Chairman"  # Default
                current_voice = speaker_voices.get(current_speaker, "21m00Tcm4TlvDq8ikWAM")
                sentence_buffer = ""
                pause_pattern = re.compile(r'([.?!])\\s*')
                
                async for chunk in llm_service.stream_response(prompt=prompt, domain=domain):
                    full_response += chunk
                    sentence_buffer += chunk
                    
                    # Check for speaker tag in full response
                    match = re.search(r'\\[(.*?)\\]', full_response)
                    if match:
                        new_speaker = match.group(1)
                        if new_speaker != current_speaker:
                            # Speaker changed - flush any pending sentence with old voice
                            if sentence_buffer.strip():
                                clean_sentence = re.sub(r'\\[.*?\\]', '', sentence_buffer).strip()
                                if clean_sentence:
                                    asyncio.create_task(stream_tts_sentence(clean_sentence, current_voice, ws))
                                sentence_buffer = ""
                            
                            current_speaker = new_speaker
                            current_voice = speaker_voices.get(current_speaker, "21m00Tcm4TlvDq8ikWAM")
                            await ws.send_json({"type": "speaker_change", "speaker": current_speaker})
                    
                    # Check for sentence completion
                    sentence_match = pause_pattern.search(sentence_buffer)
                    if sentence_match:
                        # Sentence complete! Extract and stream TTS
                        sentence = sentence_buffer[:sentence_match.end()].strip()
                        clean_sentence = re.sub(r'\\[.*?\\]', '', sentence).strip()
                        if clean_sentence:
                            asyncio.create_task(stream_tts_sentence(clean_sentence, current_voice, ws))
                        
                        # Clear buffer for next sentence
                        sentence_buffer = sentence_buffer[sentence_match.end():]
                    
                    # Send text chunk (without tags)
                    clean_chunk = re.sub(r'\\[.*?\\]', '', chunk)
                    if clean_chunk:
                        await ws.send_json({"type": "ai_text_chunk", "text": clean_chunk})
                        await ws.send_json({"type": "response_chunk", "text": clean_chunk})
                
                # Flush any remaining text in buffer
                if sentence_buffer.strip():
                    clean_sentence = re.sub(r'\\[.*?\\]', '', sentence_buffer).strip()
                    if clean_sentence:
                        asyncio.create_task(stream_tts_sentence(clean_sentence, current_voice, ws))
                
                # TTS is now streamed sentence-by-sentence above
                
                # Save clean response to database
                clean_response = re.sub(r'\\[.*?\\]', '', full_response).strip()
                client.table("interview_messages").insert({
                    "session_id": str(session_uuid),
                    "role": "assistant",
                    "content": clean_response
                }).execute()

                conversation_history.append({"role": "assistant", "content": clean_response})
                # Update Redis cache with complete conversation history
                await redis_cache.set_session_context(session_id, conversation_history)

                # Set session state to speaking
                await redis_cache.set_session_state(session_id, "speaking")
                
                # Send full response if needed
                await ws.send_json({"type": "response_complete", "text": full_response})
                
                # Set back to listening after response
                await redis_cache.set_session_state(session_id, "listening")
            except WebSocketDisconnect:
                logger.info("Client disconnected")
                break
            except Exception as e:
                logger.exception("Error during WebSocket interaction")
                try:
                    await ws.send_json({"type": "error", "message": str(e)})
                except Exception:
                    pass
                continue
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        if session_id in audio_buffers:
            del audio_buffers[session_id]
        try:
            await enqueue_analytics_generation(session_id)
            logger.info(f"Enqueued analytics generation for session: {session_id}")
        except Exception as e:
            logger.error(f"Failed to enqueue analytics: {e}")
    except Exception as e:
        logger.error(f"WebSocket Error: {e}")
""",
    
    "mockpanel-backend/main.py": """from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from db.supabase_client import get_global_supabase_client
from db.redis_client import get_redis
from api.v1.sessions import router as sessions_router
from api.v1.websockets import router as websockets_router

app = FastAPI(
    title="MockPanel Backend",
    version="1.0.0",
    debug=settings.debug
)

# Logging middleware to see all incoming requests
@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"Received request: {request.method} {request.url}")
    print(f"   Headers: {request.headers}")
    response = await call_next(request)
    return response

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(sessions_router)
app.include_router(websockets_router)

@app.get("/")
def read_root():
    return {"status": "online", "message": "Welcome to MockPanel AI Engine"}

@app.get("/env-check")
def check_env():
    env_status = {
        "ENV": settings.env,
        "SUPABASE_URL": "Loaded" if settings.supabase_url else "Not Set",
        "GEMINI_API_KEY": "Loaded" if settings.gemini_api_key else "Not Set",
        "REDIS_URL": settings.redis_url,
        "JWT_SECRET_KEY": "Loaded" if settings.jwt_secret_key else "Not Set"
    }
    return {"env_status": env_status}

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
    )
"""
}

# Script Execution
def setup_architecture():
    print("MockPanel Refactoring Script Started...\n")
    
    for file_path, content in FILES.items():
        # Create directories if they don't exist
        directory = os.path.dirname(file_path)
        if not os.path.exists(directory):
            os.makedirs(directory)
            print(f"Created folder: {directory}")
            
        # Write the file
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
            print(f"Created file: {file_path}")

    print("\nRefactoring Complete!")
    print("Next Steps:")
    print("1. Apna Next.js UI component src/app/interview/[id]/page.tsx mein move karein.")
    print("2. Frontend UI mein useWebSocket aur useExpressionAnalysis ko naye path se import karein.")

if __name__ == "__main__":
    setup_architecture()
