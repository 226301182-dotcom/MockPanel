"use client";

// app/results/[id]/page.tsx
// ════════════════════════════════════════════════════════════════════════════
// Ultra Premium Results Dashboard
// Design ref: Linear analytics + Stripe dashboard + Apple Health
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { sessionAPI, type AnalyticsData } from "@/lib/api";

// ── Score color helper ────────────────────────────────────────────────────────
function scoreConfig(score: number) {
  if (score >= 80) return { color: "#34d399", bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.25)", label: "Excellent" };
  if (score >= 65) return { color: "#fbbf24", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.25)", label: "Good" };
  if (score >= 50) return { color: "#fb923c", bg: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.25)", label: "Average" };
  return { color: "#f87171", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.25)", label: "Needs Work" };
}

// ── Animated score ring ────────────────────────────────────────────────────────
function ScoreRing({ score, size = 120, stroke = 9 }: { score: number; size?: number; stroke?: number }) {
  const ref     = useRef<SVGCircleElement>(null);
  const inView  = useInView(ref, { once: true });
  const cfg     = scoreConfig(score);
  const r       = (size - stroke) / 2;
  const circum  = 2 * Math.PI * r;
  const offset  = circum - (score / 100) * circum;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {/* Progress */}
        <motion.circle
          ref={ref}
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={cfg.color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circum}
          initial={{ strokeDashoffset: circum }}
          animate={inView ? { strokeDashoffset: offset } : {}}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          style={{ filter: `drop-shadow(0 0 8px ${cfg.color}60)` }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.5 }}
          className="font-bold tabular-nums"
          style={{ fontSize: size * 0.22, color: cfg.color, fontFamily: "var(--font-mono)" }}
        >
          {score}
        </motion.span>
        <span className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--text-tertiary)" }}>/ 100</span>
      </div>
    </div>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ label, score, delay = 0 }: { label: string; score: number; delay?: number }) {
  const ref    = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const cfg    = scoreConfig(score);

  return (
    <div ref={ref}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span className="text-xs font-bold mp-mono" style={{ color: cfg.color }}>{score}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-subtle)" }}>
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={inView ? { width: `${score}%` } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.1 + delay }}
          style={{ background: cfg.color, boxShadow: `0 0 8px ${cfg.color}40` }}
        />
      </div>
    </div>
  );
}

// ── Strength / weakness chip ──────────────────────────────────────────────────
function InsightChip({ text, type }: { text: string; type: "strength" | "weakness" | "rec" }) {
  const styles = {
    strength: { icon: "✓", color: "#34d399", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.20)" },
    weakness: { icon: "→", color: "#fbbf24", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.20)" },
    rec:      { icon: "◆", color: "#818cf8", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.20)" },
  }[type];

  return (
    <div className="flex items-start gap-2.5 p-3 rounded-xl"
      style={{ background: styles.bg, border: `1px solid ${styles.border}` }}>
      <span className="text-xs font-bold mt-0.5 flex-shrink-0" style={{ color: styles.color }}>{styles.icon}</span>
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{text}</p>
    </div>
  );
}

// ── Q&A analysis card ─────────────────────────────────────────────────────────
function QACard({ item, index }: { item: any; index: number }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="mp-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5"
          style={{ background: "var(--glass-mid)", color: "var(--text-tertiary)", border: "1px solid var(--border-default)" }}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">{item.question}</p>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} className="flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4" style={{ color: "var(--text-tertiary)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            className="overflow-hidden">
            <div className="px-4 pb-4 flex flex-col gap-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="pt-3">
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
                  Feedback
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{item.feedback}</p>
              </div>
              {item.ideal_approach && (
                <div className="p-3 rounded-xl" style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.20)" }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#818cf8" }}>
                    ◆ Ideal Approach
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{item.ideal_approach}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Polling hook (FIXED INFINITE LOOP) ────────────────────────────────────────
function useAnalytics(sessionId: string) {
  const [data,    setData]   = useState<AnalyticsData | null>(null);
  const [status,  setStatus] = useState<"loading" | "processing" | "completed" | "aborted" | "error">("loading");
  
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function poll() {
      if (cancelled) return;
      
      // Stop polling if we already have the completed data
      if (status === "completed" || status === "aborted" || status === "error") {
          return;
      }

      try {
        const res = await sessionAPI.getAnalytics(sessionId);

        if (cancelled) return;

        if (res.status === "completed") {
          setData(res);
          setStatus("completed"); // This status update breaks the loop
        } else if (res.status === "aborted_too_short") {
          setStatus("aborted");
        } else {
          setStatus("processing");
          // Re-poll only if still processing
          timeoutId = setTimeout(poll, 3000);
        }
      } catch (err) {
        if (!cancelled) setStatus("error");
      }
    }

    // Start polling immediately
    poll();

    return () => { 
        cancelled = true; 
        clearTimeout(timeoutId); 
    };
  }, [sessionId, status]); // Added status to dependency array to respect state changes

  return { data, status };
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ResultsPage() {
  const params    = useParams<{ id: string }>();
  const router    = useRouter();
  const sessionId = params?.id ?? "";

  const { data, status } = useAnalytics(sessionId);
  const [activeTab, setActiveTab] = useState<"overview" | "analysis" | "transcript">("overview");

  // ── Loading / processing state ─────────────────────────────────────────────
  if (status === "loading" || status === "processing") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)" }}>
          <svg className="w-6 h-6 animate-spin" style={{ color: "#818cf8" }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <div className="text-center">
          <p className="font-semibold text-[var(--text-primary)] mb-1">
            {status === "loading" ? "Loading results..." : "Generating your report..."}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            AI is analysing every exchange. This takes 10–20 seconds.
          </p>
        </div>
        <div className="flex gap-1.5">
          {[0,1,2].map((i) => (
            <div key={i} className="mp-thinking-dot" style={{ animationDelay: `${i * 160}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  if (status === "aborted") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-4xl">⏱️</div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Session Too Short</h2>
        <p className="text-sm text-[var(--text-secondary)] max-w-sm">
          Complete at least 2 full exchanges to generate meaningful analytics.
        </p>
        <button onClick={() => router.push("/dashboard")} className="mp-btn-primary mt-2">
          Start New Session
        </button>
      </div>
    );
  }

  if (status === "error" || !data?.scores) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">Something went wrong</h2>
        <button onClick={() => router.push("/dashboard")} className="mp-btn-primary mt-2">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const { scores, analysis, question_analysis, stats } = data;
  const overall  = scores?.overall ?? 0;
  const ocfg     = scoreConfig(overall);

  return (
    <div className="min-h-screen" style={{ background: "var(--surface-0)" }}>
      {/* Ambient */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div style={{ background: `radial-gradient(ellipse 70% 50% at 50% 0%, ${ocfg.color}0d 0%, transparent 70%)` }}
          className="absolute inset-0" />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 md:py-12">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8">
          <button onClick={() => router.push("/dashboard")} className="mp-btn-ghost">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </button>
          <div className="mp-badge mp-badge--brand">Session Report</div>
        </motion.div>

        {/* Hero score */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="mp-card p-6 mb-4 flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing score={overall} size={120} />
          <div className="flex-1 text-center sm:text-left">
            <div className="mp-badge mb-2 w-fit mx-auto sm:mx-0"
              style={{ background: ocfg.bg, borderColor: ocfg.border, color: ocfg.color }}>
              {ocfg.label}
            </div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">Overall Score</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              {stats?.total_questions ?? 0} questions · {stats?.total_responses ?? 0} responses
            </p>
            <div className="flex gap-2 mt-4 justify-center sm:justify-start">
              <button onClick={() => router.push("/dashboard")} className="mp-btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }}>
                New Session
              </button>
            </div>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.1 } }}
          className="flex gap-1 mb-4 p-1 rounded-xl"
          style={{ background: "var(--glass-light)", border: "1px solid var(--border-default)" }}>
          {(["overview", "analysis", "transcript"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="mp-tab flex-1 capitalize"
              style={activeTab === tab ? {
                background:  "var(--glass-heavy)",
                color:       "var(--text-primary)",
                border:      "1px solid var(--border-default)",
                borderRadius: 10,
              } : { borderRadius: 10 }}>
              {tab}
            </button>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">

          {/* ── Overview tab ─────────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

              {/* Score bars */}
              <div className="mp-card p-5 mb-4">
                <label className="mp-label">Dimension Scores</label>
                <div className="flex flex-col gap-4">
                  <ScoreBar label="Technical Depth"    score={scores?.technical        ?? 0} delay={0}   />
                  <ScoreBar label="Communication"      score={scores?.communication    ?? 0} delay={0.1} />
                  <ScoreBar label="Confidence"         score={scores?.confidence       ?? 0} delay={0.2} />
                  <ScoreBar label="Ethical Integrity"  score={scores?.ethical_integrity ?? 0} delay={0.3} />
                </div>
              </div>

              {/* Strengths */}
              {(analysis?.strengths?.length ?? 0) > 0 && (
                <div className="mp-card p-5 mb-4">
                  <label className="mp-label">Strengths</label>
                  <div className="flex flex-col gap-2">
                    {analysis!.strengths.map((s, i) => (
                      <InsightChip key={i} text={s} type="strength" />
                    ))}
                  </div>
                </div>
              )}

              {/* Weaknesses */}
              {(analysis?.weaknesses?.length ?? 0) > 0 && (
                <div className="mp-card p-5 mb-4">
                  <label className="mp-label">Areas to Improve</label>
                  <div className="flex flex-col gap-2">
                    {analysis!.weaknesses.map((w, i) => (
                      <InsightChip key={i} text={w} type="weakness" />
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {(analysis?.recommendations?.length ?? 0) > 0 && (
                <div className="mp-card p-5 mb-4">
                  <label className="mp-label">Action Plan</label>
                  <div className="flex flex-col gap-2">
                    {analysis!.recommendations.map((r, i) => (
                      <InsightChip key={i} text={r} type="rec" />
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Analysis tab ─────────────────────────────────────────────── */}
          {activeTab === "analysis" && (
            <motion.div key="analysis" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {(question_analysis?.length ?? 0) > 0 ? (
                <div className="flex flex-col gap-3">
                  {question_analysis!.map((item: any, i: number) => (
                    <QACard key={i} item={item} index={i} />
                  ))}
                </div>
              ) : (
                <div className="mp-card p-8 text-center">
                  <p className="text-sm text-[var(--text-tertiary)]">No question analysis available.</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Transcript tab ────────────────────────────────────────────── */}
          {activeTab === "transcript" && (
            <motion.div key="transcript" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="mp-card p-5">
                <label className="mp-label">Full Transcript</label>
                {(data as any).transcript ? (
                  <div className="rounded-xl p-4 max-h-[60vh] overflow-y-auto"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap mp-mono"
                      style={{ color: "var(--text-secondary)" }}>
                      {(data as any).transcript}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-tertiary)]">Transcript not available.</p>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}