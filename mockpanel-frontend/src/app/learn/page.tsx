"use client";

import { useState, useRef, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
type Step = "intro" | "concept" | "practice" | "feedback";
type ExamType = "UPSC" | "State PCS" | "FAANG SDE" | "Management";

interface UserDetails {
  name: string;
  exam: ExamType;
  topic: string;
  level: "Beginner" | "Intermediate" | "Advanced";
}

interface FeedbackData {
  score: number;
  strengths: string[];
  improvements: string[];
  idealPoints: string[];
  verdict: string;
}

interface ConceptData {
  question: string;
  keyPoints: string[];
  idealAnswer: string;
  commonMistakes: string[];
  timeLimit: number;
}

// ─── AI API Call ─────────────────────────────────────────────────────────────
async function callAI(prompt: string, systemPrompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}

async function fetchConceptData(details: UserDetails): Promise<ConceptData> {
  const systemPrompt = `You are an elite interview coach specializing in ${details.exam} interviews. Respond ONLY with valid JSON, no markdown, no extra text.`;
  const prompt = `Generate ONE interview question for a ${details.level} candidate preparing for ${details.exam} on topic "${details.topic}".
Return this exact JSON:
{
  "question": "the interview question",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4"],
  "idealAnswer": "a complete model answer in 4-5 sentences",
  "commonMistakes": ["mistake 1", "mistake 2", "mistake 3"],
  "timeLimit": 120
}`;
  const raw = await callAI(prompt, systemPrompt);
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

async function fetchFeedback(userAnswer: string, concept: ConceptData, details: UserDetails): Promise<FeedbackData> {
  const systemPrompt = `You are a strict but encouraging ${details.exam} interview coach. Respond ONLY with valid JSON, no markdown, no extra text.`;
  const prompt = `Evaluate this answer for: "${concept.question}"
Candidate Answer: "${userAnswer}"
Ideal Key Points: ${concept.keyPoints.join(", ")}
Return this exact JSON:
{
  "score": <0-100>,
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "idealPoints": ["must-include 1", "must-include 2", "must-include 3"],
  "verdict": "one encouraging sentence"
}`;
  const raw = await callAI(prompt, systemPrompt);
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ─── Intro + Inline Quick Form ────────────────────────────────────────────────
function IntroScreen({ onStart }: { onStart: (d: UserDetails) => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UserDetails>({
    name: "",
    exam: "UPSC",
    topic: "",
    level: "Intermediate",
  });

  const topics: Record<ExamType, string[]> = {
    UPSC: ["Indian Polity", "Ethics & Integrity", "Current Affairs", "Economy"],
    "State PCS": ["State Administration", "Local Governance", "Geography"],
    "FAANG SDE": ["Data Structures", "System Design", "Algorithms", "Behavioral"],
    Management: ["Case Studies", "Leadership", "Strategy"],
  };

  const isValid = form.name.trim() && form.topic;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
      {/* Icon */}
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-2xl shadow-violet-500/30 mx-auto">
          <span className="text-3xl">🎓</span>
        </div>
        <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-[10px] font-black text-amber-900 shadow-lg animate-bounce">
          AI
        </div>
      </div>

      <h1 className="text-4xl sm:text-5xl font-black text-zinc-900 dark:text-white tracking-tight mb-3">
        Your Personal<br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-500 to-indigo-500">
          AI Interview Coach
        </span>
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 text-base max-w-md mb-8 leading-relaxed">
        Learn <em>how</em> to answer, not just what to answer.{" "}
        <span className="text-zinc-700 dark:text-zinc-300 font-medium">Concept → Practice → Instant Feedback.</span>
      </p>

      {/* Button OR Inline Form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="h-14 px-12 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold text-base shadow-2xl shadow-violet-500/30 hover:-translate-y-1 transition-all duration-300"
        >
          Start Learning →
        </button>
      ) : (
        <div className="w-full max-w-sm text-left mt-2">
          <div className="rounded-2xl border border-zinc-100 dark:border-white/10 bg-white/90 dark:bg-white/5 backdrop-blur-xl p-6 shadow-xl flex flex-col gap-4">

            {/* Name */}
            <div>
              <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1.5">
                Your Name
              </label>
              <input
                autoFocus
                type="text"
                placeholder="e.g. Rahul"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && isValid && onStart(form)}
                className="w-full h-11 px-4 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 text-zinc-900 dark:text-white placeholder-zinc-400 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition-all"
              />
            </div>

            {/* Exam Type */}
            <div>
              <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1.5">
                Target Exam
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["UPSC", "State PCS", "FAANG SDE", "Management"] as ExamType[]).map((exam) => (
                  <button
                    key={exam}
                    onClick={() => setForm({ ...form, exam, topic: "" })}
                    className={`h-9 rounded-lg text-xs font-semibold border transition-all ${
                      form.exam === exam
                        ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                        : "border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:border-violet-300"
                    }`}
                  >
                    {exam}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic */}
            <div>
              <label className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1.5">
                Topic
              </label>
              <div className="flex flex-wrap gap-1.5">
                {topics[form.exam].map((t) => (
                  <button
                    key={t}
                    onClick={() => setForm({ ...form, topic: t })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      form.topic === t
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:border-indigo-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={() => isValid && onStart(form)}
              disabled={!isValid}
              className={`h-11 rounded-xl font-bold text-sm transition-all duration-300 ${
                isValid
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 hover:-translate-y-0.5"
                  : "bg-zinc-100 dark:bg-white/10 text-zinc-400 cursor-not-allowed"
              }`}
            >
              Let's Go →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Concept Screen ───────────────────────────────────────────────────────────
function ConceptScreen({ details, concept, onPractice }: {
  details: UserDetails; concept: ConceptData; onPractice: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    [200, 500, 800, 1100].forEach((delay, i) => setTimeout(() => setStep(i + 1), delay));
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <div className="text-xs font-bold text-violet-500 uppercase tracking-widest mb-1">Concept</div>
          <h2 className="text-2xl font-black text-zinc-900 dark:text-white">Hi {details.name}! Today's Question 👇</h2>
        </div>

        {step >= 1 && (
          <div className="rounded-2xl border border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-500/10 p-6 mb-5">
            <div className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-2">Interview Question</div>
            <p className="text-zinc-900 dark:text-white font-semibold text-lg leading-relaxed">"{concept.question}"</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
              <span className="px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/10 border border-zinc-200 dark:border-white/10">{details.exam}</span>
              <span className="px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/10 border border-zinc-200 dark:border-white/10">{details.topic}</span>
              <span className="px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/10 border border-zinc-200 dark:border-white/10">⏱ {concept.timeLimit}s</span>
            </div>
          </div>
        )}

        {step >= 2 && (
          <div className="rounded-2xl border border-zinc-100 dark:border-white/10 bg-white dark:bg-white/5 p-5 mb-4">
            <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">🔑 Key Points to Cover</div>
            {concept.keyPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-3 mb-2.5">
                <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{point}</p>
              </div>
            ))}
          </div>
        )}

        {step >= 3 && (
          <div className="rounded-2xl border border-red-100 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5 p-5 mb-4">
            <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-2">⚠️ Common Mistakes to Avoid</div>
            {concept.commonMistakes.map((m, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400 mb-1.5">
                <span className="text-red-400 mt-0.5 flex-shrink-0">✗</span> {m}
              </div>
            ))}
          </div>
        )}

        {step >= 4 && (
          <div className="rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 p-5 mb-5">
            <button
              onClick={() => setRevealed(!revealed)}
              className="w-full flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider"
            >
              <span>✨ View Ideal Answer</span>
              <span className={`transition-transform duration-300 ${revealed ? "rotate-180" : ""}`}>▼</span>
            </button>
            {revealed && (
              <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed border-t border-emerald-100 dark:border-emerald-500/20 pt-3">
                {concept.idealAnswer}
              </p>
            )}
          </div>
        )}

        {step >= 4 && (
          <button
            onClick={onPractice}
            className="w-full h-13 py-3.5 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold text-base shadow-xl shadow-violet-500/25 hover:-translate-y-0.5 transition-all duration-300"
          >
            ✍️ Now You Try →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Practice Screen ──────────────────────────────────────────────────────────
function PracticeScreen({ details, concept, onSubmit }: {
  details: UserDetails; concept: ConceptData; onSubmit: (a: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [timeLeft, setTimeLeft] = useState(concept.timeLimit);
  const [isLoading, setIsLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setTimeLeft((p) => (p > 1 ? p - 1 : 0)), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const isUrgent = timeLeft < 30;

  const handleSubmit = async () => {
    if (!answer.trim() || isLoading) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setIsLoading(true);
    await onSubmit(answer);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-5">
          <div className="text-xs font-bold text-violet-500 uppercase tracking-widest mb-1">Your Turn</div>
          <h2 className="text-2xl font-black text-zinc-900 dark:text-white">Now answer this question</h2>
        </div>

        <div className="rounded-xl border border-zinc-100 dark:border-white/10 bg-white/60 dark:bg-white/5 px-5 py-4 mb-5">
          <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium leading-relaxed">"{concept.question}"</p>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-zinc-500">Time remaining</span>
            <span className={`text-sm font-bold font-mono ${isUrgent ? "text-red-500" : "text-zinc-700 dark:text-zinc-300"}`}>
              {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${isUrgent ? "bg-red-500" : "bg-gradient-to-r from-violet-500 to-indigo-500"}`}
              style={{ width: `${(timeLeft / concept.timeLimit) * 100}%` }}
            />
          </div>
        </div>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={`${details.name}, write your answer here...`}
          rows={7}
          className="w-full rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-5 py-4 text-zinc-900 dark:text-white placeholder-zinc-400 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-none transition-all mb-4"
        />

        <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 px-4 py-3 mb-5">
          <div className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-2">💡 Remember to include:</div>
          <div className="flex flex-wrap gap-1.5">
            {concept.keyPoints.map((p, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-lg bg-white/60 dark:bg-white/10 text-zinc-600 dark:text-zinc-400 border border-amber-100 dark:border-amber-500/20">
                {p.length > 35 ? p.slice(0, 35) + "…" : p}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!answer.trim() || isLoading}
          className={`w-full h-13 py-3.5 rounded-2xl font-bold text-base transition-all duration-300 ${
            answer.trim() && !isLoading
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xl shadow-violet-500/25 hover:-translate-y-0.5"
              : "bg-zinc-100 dark:bg-white/5 text-zinc-400 cursor-not-allowed"
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              AI is evaluating...
            </span>
          ) : "Submit for Feedback ⚡"}
        </button>
      </div>
    </div>
  );
}

// ─── Feedback Screen ──────────────────────────────────────────────────────────
function FeedbackScreen({ details, concept, feedback, userAnswer, onRetry, onNew }: {
  details: UserDetails; concept: ConceptData; feedback: FeedbackData;
  userAnswer: string; onRetry: () => void; onNew: () => void;
}) {
  const scoreColor = feedback.score >= 80 ? "text-emerald-500" : feedback.score >= 60 ? "text-amber-500" : "text-red-500";
  const scoreBg = feedback.score >= 80 ? "from-emerald-500 to-teal-500" : feedback.score >= 60 ? "from-amber-500 to-orange-500" : "from-red-500 to-pink-500";
  const scoreLabel = feedback.score >= 80 ? "Excellent! 🏆" : feedback.score >= 60 ? "Good Effort 👍" : "Keep Practicing 💪";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className={`text-7xl font-black ${scoreColor} mb-1 tabular-nums`}>
            {feedback.score}<span className="text-3xl text-zinc-400">/100</span>
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-white">{scoreLabel}</div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-sm mx-auto">{feedback.verdict}</p>
          <div className="mt-4 h-2 w-full max-w-xs mx-auto rounded-full bg-zinc-100 dark:bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full bg-gradient-to-r ${scoreBg} transition-all duration-1000`} style={{ width: `${feedback.score}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/5 p-5 mb-4">
          <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-3">✅ What you did well</div>
          {feedback.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-1.5">
              <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span> {s}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-amber-100 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/5 p-5 mb-4">
          <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-3">⚡ Improve these</div>
          {feedback.improvements.map((imp, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-1.5">
              <span className="text-amber-500 mt-0.5 flex-shrink-0">→</span> {imp}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-violet-100 dark:border-violet-500/20 bg-violet-50/60 dark:bg-violet-500/5 p-5 mb-4">
          <div className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-3">🎯 Must-include next time</div>
          {feedback.idealPoints.map((pt, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300 mb-1.5">
              <span className="w-5 h-5 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
              {pt}
            </div>
          ))}
        </div>

        <details className="rounded-2xl border border-zinc-100 dark:border-white/10 bg-white dark:bg-white/5 p-5 mb-6 group">
          <summary className="text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between">
            <span>📝 Your Answer</span>
            <span className="group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed border-t border-zinc-100 dark:border-white/10 pt-3">{userAnswer}</p>
        </details>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={onRetry} className="h-12 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 text-zinc-700 dark:text-zinc-300 font-semibold text-sm hover:bg-zinc-50 dark:hover:bg-white/10 transition-all">
            🔄 Try Again
          </button>
          <button onClick={onNew} className="h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold text-sm shadow-lg shadow-violet-500/20 hover:-translate-y-0.5 transition-all">
            ➕ New Question
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LearnPage() {
  const [step, setStep] = useState<Step>("intro");
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [concept, setConcept] = useState<ConceptData | null>(null);
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [isLoadingConcept, setIsLoadingConcept] = useState(false);
  const [error, setError] = useState("");

  const loadConcept = async (d: UserDetails) => {
    setIsLoadingConcept(true);
    setError("");
    try {
      const c = await fetchConceptData(d);
      setConcept(c);
      setStep("concept");
    } catch {
      setError("Could not load question. Please try again.");
      setStep("intro");
    }
    setIsLoadingConcept(false);
  };

  const handleStart = async (d: UserDetails) => {
    setDetails(d);
    await loadConcept(d);
  };

  const handleAnswerSubmit = async (answer: string) => {
    setUserAnswer(answer);
    if (!concept || !details) return;
    const fb = await fetchFeedback(answer, concept, details);
    setFeedback(fb);
    setStep("feedback");
  };

  const handleNew = async () => {
    if (!details) return;
    setFeedback(null);
    setConcept(null);
    await loadConcept(details);
  };

  if (isLoadingConcept) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-5">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-violet-500/30 animate-pulse">
          <span className="text-2xl">🎓</span>
        </div>
        <div className="text-center">
          <p className="text-zinc-900 dark:text-white font-bold">Preparing your session...</p>
          <p className="text-sm text-zinc-500 mt-1">AI Coach is crafting the perfect question</p>
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-4 py-2 rounded-xl text-sm font-medium border border-red-200 dark:border-red-500/30 shadow-lg">
          {error}
        </div>
      )}

      {step !== "intro" && (
        <button
          onClick={() => {
            if (step === "feedback") setStep("practice");
            else if (step === "practice") setStep("concept");
            else setStep("intro");
          }}
          className="fixed top-20 left-6 z-40 w-9 h-9 rounded-full border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-sm text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-white/10 transition-all flex items-center justify-center shadow-sm text-sm"
        >
          ←
        </button>
      )}

      {step === "intro" && <IntroScreen onStart={handleStart} />}
      {step === "concept" && concept && details && (
        <ConceptScreen details={details} concept={concept} onPractice={() => setStep("practice")} />
      )}
      {step === "practice" && concept && details && (
        <PracticeScreen details={details} concept={concept} onSubmit={handleAnswerSubmit} />
      )}
      {step === "feedback" && concept && feedback && details && (
        <FeedbackScreen
          details={details} concept={concept} feedback={feedback}
          userAnswer={userAnswer}
          onRetry={() => { setStep("practice"); setFeedback(null); }}
          onNew={handleNew}
        />
      )}
    </>
  );
}