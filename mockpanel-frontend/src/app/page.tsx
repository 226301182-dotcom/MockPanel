"use client";

// app/page.tsx
// ════════════════════════════════════════════════════════════════════════════════
// PRODUCTION v3.0 — AUTH-AWARE ROUTING
//
// FIXES & UPDATES:
//   [AUTH FIX] Replaced hardcoded "/dashboard" links. Now checks if the user is 
//              logged in using `useAuth`. If not logged in, redirects to "/login".
//   [UI] Kept the clean, responsive layout and animations.
// ════════════════════════════════════════════════════════════════════════════════

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext"; // Import AuthContext

interface Pillar {
  num: string; title: string; tag: string;
  tagClass: string; desc: string; tip: string;
}

const PILLARS: Pillar[] = [
  { num: "01", title: "Clarity of Thought", tag: "Core", tagClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", desc: "Conviction over confusion. Boards immediately sense when a candidate is thinking clearly vs. fumbling for words. Every sentence should have a purpose.", tip: "AI checks for filler words and contradictions in real-time" },
  { num: "02", title: "Answer Structuring", tag: "Core", tagClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", desc: "Intro → context → conclusion, every single time. A well-structured answer signals a well-structured mind. Panels have seen thousands of answers — disorganized ones are forgotten.", tip: "AI maps your response arc and flags missing sections" },
  { num: "03", title: "Active Listening", tag: "Mental", tagClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400", desc: "The most underrated skill. Understanding the depth of a question before answering it. Most candidates hear the words but miss the intent behind them.", tip: "AI detects if your answer addressed what was actually asked" },
  { num: "04", title: "Conciseness", tag: "Verbal", tagClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400", desc: "Boards cut off candidates who ramble. Saying more with fewer words is a power move. If you need 3 sentences, don't use 10.", tip: "AI flags responses that exceed the optimal answer length" },
  { num: "05", title: "Honesty Under Pressure", tag: "Core", tagClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", desc: "Gracefully admitting 'I don't know' beats a bad bluff every time. Boards respect intellectual honesty — and they always know when you're bluffing.", tip: "AI scores the gap between your confidence and answer accuracy" },
  { num: "06", title: "Voice & Tone Modulation", tag: "Verbal", tagClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400", desc: "Flat monotone kills engagement. Knowing when to slow down, pause, or emphasize a point separates an average answer from a memorable one.", tip: "AI analyzes pitch variance, pace, and pause patterns" },
  { num: "07", title: "Non-Verbal Signals", tag: "Physical", tagClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", desc: "Posture, eye contact, gestures — these are silent but powerful. Often more influential than the actual words spoken.", tip: "AI tracks gaze distribution and posture in video mode" },
  { num: "08", title: "Stress Resilience", tag: "Mental", tagClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400", desc: "Staying composed when the board deliberately counters, pressures, or goes silent. Composure under fire is the clearest signal of executive presence.", tip: "AI measures your response delay and stability under pressure" },
  { num: "09", title: "Vocabulary Precision", tag: "Verbal", tagClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400", desc: "Right word in the right context. Professional language without being robotic. Misused technical terms signal shallow understanding immediately.", tip: "AI flags imprecise or contextually misused terminology" },
  { num: "10", title: "Presence of Mind", tag: "Mental", tagClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400", desc: "Thinking on your feet when the question is unexpected, trick-based, or rapid-fire. The board loves curveballs — how you handle them reveals character.", tip: "AI generates unexpected follow-ups to stress-test your thinking" },
];

const FEATURES = [
  { icon: <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px] flex-shrink-0"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>, text: "Real-time AI feedback on every answer" },
  { icon: <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px] flex-shrink-0"><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3"/><path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>, text: "Detailed post-session report with pillar-wise scores" },
  { icon: <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px] flex-shrink-0"><path d="M8 2l1.8 3.6L14 6.2l-3 2.9.7 4.1L8 11.1l-3.7 2.1.7-4.1-3-2.9 4.2-.6L8 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>, text: "Simulates UPSC board, PSU panel & FAANG rounds" },
  { icon: <svg viewBox="0 0 16 16" fill="none" className="w-[15px] h-[15px] flex-shrink-0"><path d="M8 2v4M8 10v4M2 8h4M10 8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>, text: "Adaptive follow-up questions, just like a real board" },
];

// ── Accordion Row ─────────────────────────────────────────────────────────────
function PillarRow({ 
  pillar, 
  isOpen, 
  onMouseEnter, 
  onMouseLeave,
  onClick 
}: { 
  pillar: Pillar; 
  isOpen: boolean; 
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  return (
    <div 
      className="border-b border-[var(--border)] last:border-b-0 relative bg-[var(--background)] z-20"
      onMouseEnter={onMouseEnter} 
      onMouseLeave={onMouseLeave} 
    >
      <button
        onClick={onClick} 
        className="w-full flex items-center gap-4 py-3.5 px-2 rounded-lg text-left
                   hover:bg-indigo-500/[0.04] transition-colors group cursor-pointer outline-none"
      >
        <span className="text-[14px] font-semibold text-[var(--muted-foreground)] tabular-nums min-w-[26px]">
          {pillar.num}
        </span>
        <span className={`flex-1 text-[16px] font-semibold leading-tight transition-colors
          ${isOpen ? "text-indigo-500" : "text-[var(--foreground)] group-hover:text-indigo-500"}`}>
          {pillar.title}
        </span>
        <span className={`text-[12px] font-semibold px-2.5 py-0.5 rounded-md ${pillar.tagClass}`}>
          {pillar.tag}
        </span>
        <motion.svg
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="w-[16px] h-[16px] text-[var(--muted-foreground)] flex-shrink-0"
          viewBox="0 0 14 14" fill="none"
        >
          <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </motion.svg>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="pl-[42px] pr-3 pb-4 pt-1">
              <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-3">
                {pillar.desc}
              </p>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium
                               text-indigo-500 bg-indigo-500/8 px-3 py-1.5 rounded-full">
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M6 5.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <circle cx="6" cy="4" r=".6" fill="currentColor"/>
                </svg>
                {pillar.tip}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Pillars Section (Right Side) ──────────────────────────────────────────────
const VISIBLE_COUNT = 7; 

function EvalPillarsCard() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [expanded, setExpanded]   = useState(false);

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);
  const visiblePillars = expanded ? PILLARS : PILLARS.slice(0, VISIBLE_COUNT);

  return (
    <div className="lg:pl-8 pt-2 relative z-10 bg-[var(--background)]"> 
      {/* Header */}
      <div className="flex items-center justify-between mb-4"> 
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          <p className="text-[12px] font-bold text-indigo-500 uppercase tracking-[0.14em]">
            Evaluation Criteria
          </p>
        </div>
        <span className="text-[12px] font-semibold text-emerald-600 dark:text-emerald-400
                         bg-emerald-500/10 px-3 py-1 rounded-full cursor-default">
          AI-Graded
        </span>
      </div>

      {/* Title */}
      <h2 className="text-[26px] font-bold tracking-tight leading-snug mb-6"> 
        10 Pillars the Board
        <span className="block text-[22px] text-[var(--text-secondary)] font-normal mt-1">
          actually judges you on
        </span>
      </h2>

      {/* List + Fade Gradient */}
      <div className="relative z-10">
        <div onMouseLeave={() => setOpenIndex(null)}>
          {visiblePillars.map((pillar, i) => (
            <PillarRow
              key={pillar.num}
              pillar={pillar}
              isOpen={openIndex === i}
              onMouseEnter={() => setOpenIndex(i)}   
              onMouseLeave={() => setOpenIndex(null)} 
              onClick={() => toggle(i)}              
            />
          ))}
        </div>

        <AnimatePresence>
          {!expanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none z-30
                         bg-gradient-to-t from-[var(--background)] via-[var(--background)]/90 to-transparent"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Expand / collapse Button */}
      <div className="mt-5 flex justify-center pb-2 relative z-40"> 
        <button
          onClick={() => { setExpanded(!expanded); if (expanded) setOpenIndex(null); }}
          className="flex items-center justify-center gap-2 text-[14px] font-semibold whitespace-nowrap
                     text-[var(--foreground)] border border-[var(--border)]
                     bg-[var(--background)] hover:border-indigo-500/40 hover:text-indigo-500
                     px-6 py-3 rounded-full transition-all group cursor-pointer shadow-sm"
        >
          {expanded ? "Show less" : "View all 10 pillars"}
          <motion.svg
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="w-4 h-4"
            viewBox="0 0 16 16" fill="none"
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round"/>
          </motion.svg>
        </button>
      </div>
    </div>
  );
}

// ── Ambient Background ────────────────────────────────────────────────────────
function AmbientMesh({ domain }: { domain: string | null }) {
  const color = domain === "upsc" ? "#f59e0b" : domain === "psu" ? "#10b981" : "#6366f1";
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div style={{ background: "var(--background)" }} className="absolute inset-0 transition-colors duration-300" />
      <motion.div
        animate={{ background: `radial-gradient(ellipse 80% 60% at 20% 0%, ${color}0d 0%, transparent 70%)` }}
        transition={{ duration: 1.2, ease: "easeOut" }}
        className="absolute inset-0"
      />
      <div className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 50% at 80% 100%, rgba(99,102,241,0.06) 0%, transparent 70%)" }}
      />
      <div className="absolute inset-0 opacity-[0.025]"
        style={{ backgroundImage: "linear-gradient(rgba(120,120,120,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(120,120,120,.15) 1px, transparent 1px)", backgroundSize: "60px 60px" }}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth(); // Check user authentication state

  // Target route based on auth status
  const targetRoute = user ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <AmbientMesh domain={null} />
      
      <section className="max-w-7xl mx-auto px-6 pt-12 md:pt-20 pb-16 
                          grid lg:grid-cols-[45%_50%] gap-12 items-start min-h-[85vh]"> 

        {/* LEFT COLUMN - Sticky Fixed */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="relative lg:sticky lg:top-32 z-20 bg-[var(--background)] lg:bg-transparent pb-8 lg:pb-0" 
        >
          <span className="px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20
                           text-indigo-500 text-[11px] font-bold uppercase tracking-widest
                           mb-5 inline-block cursor-default whitespace-nowrap"> 
            Elite AI Interview Board
          </span>

          <h1 className="text-5xl md:text-[60px] font-black leading-[1.04] tracking-tight mb-5"> 
            Master your next <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-violet-500">
              board interview.
            </span>
          </h1>

          <p className="text-[var(--text-secondary)] text-[18px] leading-relaxed mb-8 max-w-sm"> 
            Face an authentic AI panel simulation for UPSC, PSU, and FAANG interviews.
            Scored across 10 real evaluation parameters — exactly what a live board looks for.
          </p>

          {/* Feature bullets */}
          <ul className="space-y-3.5 mb-10"> 
            {FEATURES.map((f, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.07, duration: 0.4 }}
                className="flex items-center gap-3 text-[15px] text-[var(--text-secondary)]"
              >
                <span className="text-indigo-500">{f.icon}</span>
                {f.text}
              </motion.li>
            ))}
          </ul>

          {/* CTAs - Links conditionally point to dashboard or login */}
          <div className="flex flex-wrap gap-4">
            <Link 
              href={targetRoute} 
              className="mp-btn-primary px-7 py-3.5 text-[15px] cursor-pointer inline-flex items-center justify-center whitespace-nowrap"
            >
              Take Mock Interview
            </Link>
            <Link
              href={targetRoute}
              className="px-7 py-3.5 rounded-xl border border-[var(--border)]
                         font-semibold hover:bg-[var(--muted)] transition-all text-[15px] 
                         cursor-pointer inline-flex items-center justify-center whitespace-nowrap bg-[var(--background)]"
            >
              AI Coach
            </Link>
          </div>
        </motion.div>

        {/* RIGHT COLUMN */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="relative z-10"
        >
          <EvalPillarsCard />
        </motion.div>
      </section>

      {/* Goal Selector */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-[var(--border)] relative z-10 bg-[var(--background)]">
        <p className="text-center text-[11px] font-bold text-[var(--muted-foreground)]
                      uppercase tracking-[0.2em] mb-12">
          Select Your Path
        </p>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { title: "UPSC Civil Services", desc: "Board-style Personality Test with 5 IAS/IPS personas.", icon: "⚖️" },
            { title: "PSU Engineering",     desc: "Technical & HR Panel for NTPC, BHEL, and ONGC.",      icon: "🏭" },
            { title: "FAANG SDE Rounds",    desc: "System Design and Behavioral drills for Big Tech.",    icon: "⚡" },
          ].map((goal) => (
            <Link href={targetRoute} key={goal.title}
              className="mp-card p-8 hover:-translate-y-1 transition-all group cursor-pointer bg-[var(--card)]">
              <div className="text-4xl mb-6 grayscale group-hover:grayscale-0 transition-all">{goal.icon}</div>
              <h4 className="font-bold text-xl mb-2">{goal.title}</h4>
              <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed">{goal.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA Bottom - Conditional routing */}
      <section className="max-w-4xl mx-auto px-6 py-16 md:py-24 text-center relative z-10 bg-[var(--background)]">
        <div className="mp-card p-8 md:p-16 bg-gradient-to-b from-transparent to-indigo-500/5 overflow-hidden mx-auto max-w-[90%] sm:max-w-none">
          <h2 className="text-3xl md:text-4xl font-black mb-4">Ready to enter the room?</h2>
          <p className="text-[var(--text-secondary)] mb-8 md:mb-10 text-base md:text-lg">
            Your personalized session starts in 60 seconds.
          </p>
          <Link 
            href={targetRoute} 
            className="mp-btn-primary px-6 md:px-10 py-3.5 md:py-4 text-[15px] md:text-lg cursor-pointer inline-flex items-center justify-center whitespace-nowrap w-full sm:w-auto"
          >
            Start Free Session
          </Link>
        </div>
      </section>
    </div>
  );
}