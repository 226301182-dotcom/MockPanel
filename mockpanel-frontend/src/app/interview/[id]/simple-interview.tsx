"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import { useWebSocket } from "@/hooks/useWebSocket";

// Simple interviewer config based on domain
const INTERVIEWER_CONFIGS = {
  upsc: {
    name: "Shri A. Kumar IAS",
    title: "Board Chairman · IAS (Retd.)",
    avatar: "AK",
    accentColor: "#E8B84B"
  },
  sde: {
    name: "Sarah Johnson", 
    title: "Engineering Manager",
    avatar: "SJ",
    accentColor: "#4F9EFF"
  },
  psu: {
    name: "Dr. Rajesh Verma",
    title: "Board Director · PSU", 
    avatar: "RV",
    accentColor: "#22C55E"
  }
};

export default function SimpleInterviewPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id ?? "unknown";

  const wsUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host  = window.location.host; 
    return `${proto}//${host}/ws/v1/interview/${sessionId}`;
  }, [sessionId]);

  // 🔥 1. Added streamingText to show live typing
  const { status, messages, sendJson, streamingText } = useWebSocket(wsUrl, null);

  // State
  const [sessionData, setSessionData] = useState<any>(null);
  const [interviewType, setInterviewType] = useState<'upsc' | 'sde' | 'psu'>('upsc');
  const [interviewer, setInterviewer] = useState(INTERVIEWER_CONFIGS.upsc);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [userAnswer, setUserAnswer] = useState("");
  const [conversation, setConversation] = useState<Array<{type: 'question' | 'answer', text: string, timestamp: Date}>>([]);
  const [isInterviewerThinking, setIsInterviewerThinking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const lastProcessedIndex = useRef(-1);

  // Fetch session data
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const apiUrl = `/api/v1/sessions/${sessionId}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("Failed to fetch");
        const data = await response.json();
        setSessionData(data);
        const type = data.domain || 'upsc';
        
        setInterviewType(type as 'upsc' | 'sde' | 'psu');
        setInterviewer(INTERVIEWER_CONFIGS[type as keyof typeof INTERVIEWER_CONFIGS]);
      } catch (error) {
        console.error('Failed to fetch session:', error);
      }
    };
    fetchSession();
  }, [sessionId]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    
    const newMsgs = messages.slice(lastProcessedIndex.current + 1);

    newMsgs.forEach(msg => {
      if (!msg) return;
      
      if (msg.type === "question" || msg.type === "response_complete") {
        if (msg.text) {
          setCurrentQuestion(msg.text);
          setIsInterviewerThinking(false);
          setConversation(prev => [...prev, {type: 'question', text: msg.text, timestamp: new Date()}]);
        }
      } else if (msg.type === "thinking") {
        setIsInterviewerThinking(!!msg.status);
      }
    });

    lastProcessedIndex.current = messages.length - 1;
  }, [messages]);

  // 🔥 2. AUTO-PROMPT (Silence Detection Timer)
  useEffect(() => {
    // अगर इंटरव्यूअर खुद सोच रहा है या कनेक्टेड नहीं है, तो टाइमर मत चलाओ
    if (status !== 'connected' || isInterviewerThinking) return;

    // 20 सेकंड का टाइमर (आप इसे 15 या 30 भी कर सकते हैं)
    const silenceTimer = setTimeout(() => {
      setIsInterviewerThinking(true);
      // AI को एक हिडन प्रॉम्प्ट भेजो कि यूजर शांत है
      sendJson({
        type: "text",
        text: "[System Alert: The candidate has been completely silent for 20 seconds. Ask them politely if they are still there, if they need more time, or if they want a hint. Keep it short.]"
      });
    }, 20000); // 20000 ms = 20 seconds

    // अगर यूजर कुछ भी टाइप करता है, तो टाइमर रीसेट हो जाएगा
    return () => clearTimeout(silenceTimer);
  }, [conversation, status, isInterviewerThinking, userAnswer, sendJson]);

  const submitAnswer = async () => {
    if (!userAnswer.trim()) return;
    
    setIsSubmitting(true);
    
    setConversation(prev => [...prev, {type: 'answer', text: userAnswer.trim(), timestamp: new Date()}]);
    
    sendJson({
      type: "text",
      text: userAnswer.trim()
    });
    
    setUserAnswer("");
    setIsInterviewerThinking(true);
    setIsSubmitting(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitAnswer();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <div 
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold"
                style={{ backgroundColor: interviewer.accentColor }}
              >
                {interviewer.avatar}
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{interviewer.name}</h1>
                <p className="text-sm text-gray-600">{interviewer.title}</p>
              </div>
            </div>
            <div className="h-8 w-px bg-gray-300" />
            <div className="text-sm text-gray-600">
              <span className="font-medium uppercase">{interviewType}</span> Interview
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-sm text-gray-600 capitalize">{status === 'connected' ? 'Connected' : status}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 flex-1 w-full flex flex-col">
        
        {/* Current Question Focus */}
        {currentQuestion && (
          <div className="mb-6 flex-shrink-0">
            <div className="flex items-start space-x-3">
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                style={{ backgroundColor: interviewer.accentColor }}
              >
                {interviewer.avatar}
              </div>
              <div className="flex-1">
                <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-md">
                  <p className="text-gray-900 text-lg font-medium">{currentQuestion}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Conversation History */}
        <div className="flex-1 overflow-y-auto pr-2 mb-6 space-y-5 min-h-[30vh]">
          {conversation.map((item, index) => (
            <div key={index} className="flex items-start space-x-3">
              {item.type === 'question' ? (
                <>
                  <div 
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-1"
                    style={{ backgroundColor: interviewer.accentColor }}
                  >
                    {interviewer.avatar}
                  </div>
                  <div className="flex-1">
                    <div className="bg-gray-100 rounded-xl p-3.5 inline-block max-w-[85%] border border-gray-200">
                      <p className="text-sm text-gray-900 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1 flex justify-end">
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 inline-block max-w-[85%] text-right">
                      <p className="text-sm text-gray-900 text-left leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                  <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-1">
                    U
                  </div>
                </>
              )}
            </div>
          ))}

          {/* 🔥 3. LIVE STREAMING TYPING EFFECT */}
          {isInterviewerThinking && streamingText && (
            <div className="flex items-start space-x-3 animate-in fade-in slide-in-from-bottom-2">
              <div 
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-1 shadow-sm"
                style={{ backgroundColor: interviewer.accentColor }}
              >
                {interviewer.avatar}
              </div>
              <div className="flex-1">
                <div className="bg-gray-100 rounded-xl p-3.5 inline-block max-w-[85%] border border-gray-200 shadow-sm">
                  <p className="text-sm text-gray-900 leading-relaxed">
                    {streamingText}
                    <span className="inline-block w-1.5 h-3 ml-1 bg-gray-500 animate-pulse align-middle"></span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Thinking Indicator (Before streaming starts) */}
          {isInterviewerThinking && !streamingText && (
            <div className="flex items-start space-x-3">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-1" style={{ backgroundColor: interviewer.accentColor }}>
                {interviewer.avatar}
              </div>
              <div className="bg-gray-100 rounded-full px-4 py-2 border border-gray-200 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        {/* Answer Input */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-md flex-shrink-0">
          <div className="p-4">
            <textarea
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={isInterviewerThinking ? "Wait for the interviewer to finish..." : "Type your answer here... (Press Enter to submit)"}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 text-sm leading-relaxed"
              rows={3}
              disabled={isSubmitting || isInterviewerThinking || status !== 'connected'}
            />
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 rounded-b-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
              <p className="text-xs text-gray-500 font-medium">
                {status === 'connected' ? 'Press Enter to send' : 'Reconnecting...'}
              </p>
            </div>
            <button
              onClick={submitAnswer}
              disabled={!userAnswer.trim() || isSubmitting || isInterviewerThinking || status !== 'connected'}
              className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {isSubmitting ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}