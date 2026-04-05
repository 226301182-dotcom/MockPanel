"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useWebSocket } from "@/hooks/useWebSocket";

const INTERVIEWER_CONFIGS = {
  upsc: { name: "Shri A. Kumar IAS", title: "Board Chairman · IAS (Retd.)", avatar: "AK", accentColor: "#E8B84B" },
  sde:  { name: "Sarah Johnson",      title: "Engineering Manager",           avatar: "SJ", accentColor: "#4F9EFF" },
  psu:  { name: "Dr. Rajesh Verma",   title: "Board Director · PSU",          avatar: "RV", accentColor: "#22C55E" },
};

export default function SimpleInterviewPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id ?? "unknown";

  // ── WS URL FIX: Connects to Render backend instead of Vercel ──
  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    
    // Check for Environment Variable, fallback to current host
    const apiBase = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
    const wsBase = apiBase.replace(/^http/, "ws"); // Converts http -> ws or https -> wss
    
    return `${wsBase}/ws/v1/interview/${sessionId}`;
  }, [sessionId]);

  const { status, messages, sendJson, streamingText } = useWebSocket(wsUrl, null);

  const [sessionData, setSessionData] = useState<any>(null);
  const [interviewType, setInterviewType] = useState<"upsc" | "sde" | "psu">("upsc");
  const [interviewer, setInterviewer] = useState(INTERVIEWER_CONFIGS.upsc);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [userAnswer, setUserAnswer] = useState("");
  const [conversation, setConversation] = useState<Array<{ type: "question" | "answer"; text: string; timestamp: Date }>>([]);
  const [isInterviewerThinking, setIsInterviewerThinking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const lastProcessedIndex = useRef(-1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation, streamingText]);

  // Fetch session data
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/v1/sessions/${sessionId}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setSessionData(data);
        const type = (data.domain || "upsc") as "upsc" | "sde" | "psu";
        setInterviewType(type);
        setInterviewer(INTERVIEWER_CONFIGS[type]);
      } catch (e) {
        console.error("Failed to fetch session:", e);
      }
    };
    if (sessionId !== "unknown") fetchSession();
  }, [sessionId]);

  // ── TS FIX: Strict Narrowing for WebSocket Messages ──
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const newMsgs = messages.slice(lastProcessedIndex.current + 1);

    newMsgs.forEach((msg: any) => {
      if (!msg) return;

      if (msg.type === "question" || msg.type === "response_complete") {
        // Explicitly ensuring text is a string
        const textValue = typeof msg.text === "string" ? msg.text : "";
        
        if (textValue) {
          setCurrentQuestion(textValue);
          setIsInterviewerThinking(false);
          setConversation((prev) => [...prev, { type: "question", text: textValue, timestamp: new Date() }]);
        }
      } else if (msg.type === "thinking") {
        setIsInterviewerThinking(!!msg.status);
      }
    });

    lastProcessedIndex.current = messages.length - 1;
  }, [messages]);

  // Silence detection timer
  useEffect(() => {
    if (status !== "connected" || isInterviewerThinking) return;
    const silenceTimer = setTimeout(() => {
      setIsInterviewerThinking(true);
      sendJson({
        type: "text",
        text: "[System Alert: The candidate has been completely silent for 20 seconds. Ask them politely if they are still there.]",
      });
    }, 20000);
    return () => clearTimeout(silenceTimer);
  }, [conversation, status, isInterviewerThinking, sendJson]);

  const submitAnswer = async () => {
    if (!userAnswer.trim()) return;
    setIsSubmitting(true);
    const text = userAnswer.trim();
    setConversation((prev) => [...prev, { type: "answer", text, timestamp: new Date() }]);
    sendJson({ type: "text", text });
    setUserAnswer("");
    setIsInterviewerThinking(true);
    setIsSubmitting(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitAnswer();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold"
                style={{ backgroundColor: interviewer.accentColor }}>
                {interviewer.avatar}
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{interviewer.name}</h1>
                <p className="text-sm text-gray-600">{interviewer.title}</p>
              </div>
            </div>
            <div className="h-8 w-px bg-gray-300 hidden sm:block" />
            <div className="text-sm text-gray-600 hidden sm:block">
              <span className="font-medium uppercase">{interviewType}</span> Interview
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${status === "connected" ? "bg-green-500" : "bg-amber-500 animate-pulse"}`} />
            <span className="text-xs text-gray-600 capitalize">{status}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-6 flex-1 w-full flex flex-col overflow-hidden">
        {/* Conversation History */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto mb-6 space-y-6 px-2 scroll-smooth"
        >
          {conversation.map((item, index) => (
            <div key={index} className={`flex items-start space-x-3 ${item.type === 'answer' ? 'flex-row-reverse space-x-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-1 shadow-sm`}
                style={{ backgroundColor: item.type === 'question' ? interviewer.accentColor : '#334155' }}>
                {item.type === 'question' ? interviewer.avatar : 'U'}
              </div>
              <div className={`flex-1 max-w-[80%] ${item.type === 'answer' ? 'text-right' : ''}`}>
                <div className={`rounded-2xl p-4 shadow-sm border ${
                  item.type === 'question' 
                  ? 'bg-white border-gray-200 text-gray-800' 
                  : 'bg-indigo-600 border-indigo-700 text-white'
                }`}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</p>
                </div>
                <span className="text-[10px] text-gray-400 mt-1 block">
                  {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {/* Streaming/Thinking indicators */}
          {isInterviewerThinking && (
            <div className="flex items-start space-x-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-1"
                style={{ backgroundColor: interviewer.accentColor }}>
                {interviewer.avatar}
              </div>
              <div className="bg-gray-100 rounded-2xl p-4 border border-gray-200 max-w-[80%]">
                {streamingText ? (
                  <p className="text-sm text-gray-800 leading-relaxed">
                    {streamingText}
                    <span className="inline-block w-2 h-4 ml-1 bg-indigo-400 animate-pulse align-middle" />
                  </p>
                ) : (
                  <div className="flex items-center gap-1.5 py-1">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Answer Input */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-xl p-2 transition-all focus-within:ring-2 focus-within:ring-indigo-500">
          <textarea
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={isInterviewerThinking ? "Please wait for a moment..." : "Type your answer and press Enter..."}
            className="w-full px-4 py-3 bg-transparent border-none focus:ring-0 resize-none text-gray-800 text-sm placeholder:text-gray-400"
            rows={3}
            disabled={isSubmitting || isInterviewerThinking || status !== "connected"}
          />
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl border-t border-gray-100">
             <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-red-400'}`} />
                <span className="text-[10px] font-medium text-gray-500">
                  {status === 'connected' ? 'WebSocket Active' : 'Disconnected'}
                </span>
             </div>
             <button
                onClick={submitAnswer}
                disabled={!userAnswer.trim() || isSubmitting || isInterviewerThinking}
                className="px-5 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-30 transition-all active:scale-95 shadow-md"
             >
               {isSubmitting ? "SENDING..." : "SUBMIT"}
             </button>
          </div>
        </div>
      </main>
    </div>
  );
}