"use client";

// app/dashboard/page.tsx
import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import { sessionAPI, type CreateSessionRequest } from "@/lib/api";

type Domain = "upsc" | "psu" | "sde";
type Mode   = "interview" | "coach";

// ─── Domain config ───────────────────────────────────────────────────────────
const DOMAINS = [
  {
    id:    "upsc" as Domain,
    label: "UPSC",
    sub:   "Civil Services Personality Test",
    icon:  "⚖️",
    accent: "#f59e0b",
    accentBg: "rgba(245,158,11,0.08)",
    accentText: "#fbbf24",
    desc:  "Simulate the real UPSC interview board with 5 retired IAS/IFS/IPS officers probing your DAF, ethics, governance and current affairs.",
  },
  {
    id:    "psu" as Domain,
    label: "PSU",
    sub:   "NTPC · BHEL · ONGC · IOCL · SAIL",
    icon:  "🏭",
    accent: "#10b981",
    accentBg: "rgba(16,185,129,0.08)",
    accentText: "#34d399",
    desc:  "Face a 3-member board: Director, Technical Expert, and HR. Deep plant-scenario questioning and core engineering fundamentals.",
  },
  {
    id:    "sde" as Domain,
    label: "SDE",
    sub:   "Google · Meta · Razorpay · Meesho",
    icon:  "⚡",
    accent: "#6366f1",
    accentBg: "rgba(99,102,241,0.08)",
    accentText: "#818cf8",
    desc:  "Full-loop engineering interview: resume deep-dive, system design, technical depth drill, and behavioral failure probe.",
  },
] as const;

const TOPICS: Record<Domain, string[]> = {
  upsc: ["Indian Polity", "Ethics & Integrity", "Current Affairs", "Economy & Finance", "Governance", "Internal Security", "Geography"],
  psu:  ["Thermodynamics", "Power Systems", "Plant Safety & HAZOP", "Core Engineering", "Project Management", "Industrial Relations"],
  sde:  ["System Design", "Data Structures", "Algorithms", "Distributed Systems", "Behavioral", "API Design", "Database Design"],
};

const spring = { type: "spring", stiffness: 380, damping: 32 };

// ─── Ambient mesh background ──────────────────────────────────────────────────
function AmbientMesh({ domain }: { domain: Domain | null }) {
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

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map((s) => (
        <motion.div
          key={s}
          animate={{
            width:      s === step ? 28 : 8,
            background: s <= step ? "#6366f1" : "rgba(120,120,120,0.2)",
          }}
          transition={spring}
          className="h-1.5 rounded-full"
        />
      ))}
      <span className="ml-1 text-[11px] font-semibold text-[var(--muted-foreground)] tabular-nums">
        {step} / 3
      </span>
    </div>
  );
}

// ─── Glassmorphic borderless card ─────────────────────────────────────────────
function Card({
  children, className = "", onClick, selected, accentColor,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
  accentColor?: string;
}) {
  return (
    <motion.div
      whileHover={onClick ? { y: -2, scale: 1.005 } : {}}
      whileTap={onClick ? { scale: 0.995 } : {}}
      onClick={onClick}
      className={`relative rounded-[24px] transition-all duration-300 ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{
        background:  selected ? `${accentColor}10` : "var(--card)",
        boxShadow:   selected ? `0 12px 40px rgba(0,0,0,0.15)` : "0 4px 20px rgba(0,0,0,0.02)",
        border:      selected ? `1px solid ${accentColor}30` : "1px solid transparent",
      }}
    >
      {selected && (
        <div className="absolute inset-0 rounded-[24px]" style={{ background: `radial-gradient(circle at top left, ${accentColor}08, transparent)` }} />
      )}
      {children}
    </motion.div>
  );
}

// ─── Select component ─────────────────────────────────────────────────────────
function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2 block">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-12 pl-4 pr-10 rounded-xl text-[15px] font-medium text-[var(--foreground)] appearance-none outline-none transition-all duration-150 cursor-pointer border-none bg-[var(--muted)] hover:bg-[var(--muted)]/80 focus:ring-2 focus:ring-indigo-500/30"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-[var(--card)]">{o.label}</option>
          ))}
        </select>
        <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-[var(--muted-foreground)]"
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}

// ─── Input component ──────────────────────────────────────────────────────────
function Input({
  label, value, onChange, placeholder, optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-0">{label}</label>
        {optional && <span className="text-[10px] text-[var(--muted-foreground)] font-medium opacity-70">Optional</span>}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-12 px-4 rounded-xl text-[15px] font-medium text-[var(--foreground)] border-none outline-none transition-all duration-150 bg-[var(--muted)] hover:bg-[var(--muted)]/80 focus:ring-2 focus:ring-indigo-500/30 placeholder:text-[var(--muted-foreground)]/50"
      />
    </div>
  );
}

// ─── Tag chip ─────────────────────────────────────────────────────────────────
function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 border-none outline-none flex items-center gap-2"
      style={{
        background:  selected ? "rgba(99,102,241,0.15)" : "var(--muted)",
        color:       selected ? "#6366f1" : "var(--muted-foreground)",
      }}
    >
      {label}
      {selected && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
    </motion.button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [step,             setStep]           = useState<1 | 2 | 3>(1);
  const [mode,             setMode]           = useState<Mode>("interview");
  const [domain,           setDomain]         = useState<Domain | null>(null);
  const [name,             setName]           = useState("");
  const [targetYear,       setTargetYear]     = useState("");
  
  // 🔥 UPDATE: String se Array me change kar diya gaya hai multiple select ke liye
  const [topics,           setTopics]         = useState<string[]>([]);
  const [customTopic,      setCustomTopic]    = useState(""); // For input box
  
  const [resumeFile,       setResumeFile]     = useState<File | null>(null);
  const [isDragging,       setIsDragging]     = useState(false);
  const [durationMins,     setDurationMins]   = useState("40");
  const [difficulty,       setDifficulty]     = useState("Moderate");
  const [language,         setLanguage]       = useState("English");
  const [submitting,       setSubmitting]     = useState(false);
  const [error,            setError]          = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const selectedDomain = DOMAINS.find((d) => d.id === domain);
  const canStep1 = domain !== null;
  // Validation array length se check hogi
  const canStep2 = name.trim().length >= 2 && (mode === "interview" || topics.length > 0);

  // Helper to toggle topic selection
  const toggleTopic = (t: string) => {
    if (topics.includes(t)) {
      setTopics(topics.filter((item) => item !== t));
    } else {
      setTopics([...topics, t]);
    }
  };

  const handleAddCustomTopic = () => {
    const t = customTopic.trim();
    if (t && !topics.includes(t)) {
      setTopics([...topics, t]);
    }
    setCustomTopic("");
  };

  async function handleStart() {
    if (!domain || !canStep2) return;
    setSubmitting(true);
    setError(null);

    try {
      const payload: CreateSessionRequest = {
        domain:          domain,
        mode:            mode as any,
        name:            name.trim(),
        targetYear:      targetYear.trim() || undefined,
        durationMinutes: parseInt(durationMins),
        difficulty:      difficulty as any,
        language:        language as any,
        // Backend ke hisab se comma separated string me bhej rahe hain
        topic:           topics.length > 0 ? topics.join(", ") : undefined, 
      };

      const session = await sessionAPI.createSession(payload);

      if (resumeFile && mode === "interview") {
        try {
          await sessionAPI.uploadResume(session.session_id, resumeFile);
        } catch (e) {
          console.warn("Resume upload failed (continuing):", e);
        }
      }

      window.location.href = `/interview/${session.session_id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
      setSubmitting(false);
    }
  }

  const slideVariants = {
    enter: (dir: number) => ({ opacity: 0, x: dir * 32 }),
    center: { opacity: 1, x: 0 },
    exit:  (dir: number) => ({ opacity: 0, x: -dir * 32 }),
  };

  return (
    <>
      <AmbientMesh domain={domain} />

      <main className="min-h-screen flex flex-col items-center pt-10 md:pt-14 pb-12 px-4">
        
        {/* Step Indicator */}
        <div className="w-full max-w-2xl flex justify-end mb-8">
           <StepBar step={step} />
        </div>

        <div className="w-full max-w-2xl">

          {/* Error Banner */}
          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mb-8 flex items-center gap-3 px-5 py-4 rounded-xl text-[15px] font-medium"
                style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444" }}>
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Steps */}
          <AnimatePresence mode="wait" custom={1}>

            {/* ── Step 1: Mode + Domain ──────────────────────────────────── */}
            {step === 1 && (
              <motion.div key="s1" variants={slideVariants} custom={1}
                initial="enter" animate="center" exit="exit" transition={spring}>

                <div className="mb-8">
                  <span className="inline-block px-3 py-1 bg-indigo-500/10 text-indigo-500 rounded-full text-xs font-bold uppercase tracking-wider mb-4">Step 1 of 3 · Setup</span>
                  <h1 className="text-4xl md:text-5xl font-black tracking-tight text-[var(--foreground)] mb-3">
                    Choose your path
                  </h1>
                  <p className="text-lg text-[var(--muted-foreground)]">
                    Select interview mode and domain to get started.
                  </p>
                </div>

                {/* Mode toggle */}
                <div className="mb-8">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 block">Mode</label>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { id: "interview" as Mode, icon: "👔", title: "Mock Interview", desc: "Full board simulation. No hints." },
                      { id: "coach"     as Mode, icon: "💡", title: "AI Coach",       desc: "Guided practice with feedback." },
                    ].map((m) => (
                      <Card key={m.id} onClick={() => setMode(m.id)} selected={mode === m.id}
                        accentColor="#6366f1" className="p-5 border-none">
                        <div className="relative z-10">
                          <div className="text-3xl mb-4">{m.icon}</div>
                          <div className="text-[17px] font-bold text-[var(--foreground)] mb-1">{m.title}</div>
                          <div className="text-sm text-[var(--muted-foreground)] leading-relaxed">{m.desc}</div>
                          {mode === m.id && (
                            <div className="absolute top-0 right-0 w-6 h-6 rounded-full flex items-center justify-center bg-indigo-500 shadow-[0_4px_12px_rgba(99,102,241,0.4)]">
                              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Domain selection */}
                <div className="mb-10">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 block">Interview Domain</label>
                  <div className="flex flex-col gap-4">
                    {DOMAINS.map((d) => (
                      <Card key={d.id} onClick={() => setDomain(d.id)} selected={domain === d.id}
                        accentColor={d.accent} className="p-5 border-none">
                        <div className="relative z-10 flex items-center gap-5">
                          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
                            style={{ background: d.accentBg }}>
                            {d.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1.5">
                              <span className="text-lg font-black text-[var(--foreground)]">{d.label}</span>
                              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                                style={{ background: d.accentBg, color: d.accentText }}>
                                {d.sub}
                              </span>
                            </div>
                            <p className="text-[15px] text-[var(--muted-foreground)] leading-relaxed">{d.desc}</p>
                          </div>
                          {domain === d.id && (
                            <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                              style={{ background: d.accent, boxShadow: `0 4px 12px ${d.accent}66` }}>
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <motion.button
                    whileHover={canStep1 ? { y: -1 } : {}}
                    whileTap={canStep1 ? { scale: 0.98 } : {}}
                    onClick={() => canStep1 && setStep(2)}
                    disabled={!canStep1}
                    className="flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-[15px] text-white bg-indigo-600 disabled:opacity-40 transition-opacity outline-none border-none cursor-pointer"
                  >
                    Continue
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Profile ────────────────────────────────────────── */}
            {step === 2 && (
              <motion.div key="s2" variants={slideVariants} custom={1}
                initial="enter" animate="center" exit="exit" transition={spring}>

                <div className="mb-8">
                  <span className="inline-block px-3 py-1 bg-amber-500/10 text-amber-500 rounded-full text-xs font-bold uppercase tracking-wider mb-4">Step 2 of 3 · Profile</span>
                  <h1 className="text-4xl md:text-5xl font-black tracking-tight text-[var(--foreground)] mb-3">
                    Tell us about you
                  </h1>
                  <p className="text-lg text-[var(--muted-foreground)]">
                    The AI panel uses this to personalise every question.
                  </p>
                </div>

                <div className="p-8 mb-6 flex flex-col gap-6 rounded-3xl bg-[var(--card)] shadow-lg">
                  <Input label="Your Full Name" value={name} onChange={setName} placeholder="e.g. Rahul Kumar" />
                  <Input label="Target Year" value={targetYear} onChange={setTargetYear} placeholder="e.g. 2026" optional />
                </div>

                {/* Focus Topic (Multiple Selection supported) */}
                <motion.div key="topic" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-8">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 block">
                    Focus Topics <span className={mode === "coach" ? "text-red-500" : "opacity-60 normal-case tracking-normal"}>{mode === "coach" ? "*" : "(Optional for Mock)"}</span>
                  </label>
                  <div className="p-6 rounded-3xl bg-[var(--card)] shadow-lg">
                    
                    <div className="flex flex-wrap gap-2.5 mb-4">
                      {/* Default list wale chips */}
                      {domain && TOPICS[domain].map((t) => (
                        <Chip key={t} label={t} selected={topics.includes(t)} onClick={() => toggleTopic(t)} />
                      ))}

                      {/* Custom add kiye hue chips dikhane ke liye */}
                      {topics.filter((t) => domain && !TOPICS[domain].includes(t)).map((t) => (
                        <Chip key={t} label={t} selected={true} onClick={() => toggleTopic(t)} />
                      ))}
                    </div>

                    {/* Custom Topic Input Box */}
                    <div className="pt-2 flex gap-2">
                      <input
                        type="text"
                        placeholder="Add a custom topic..."
                        value={customTopic}
                        onChange={(e) => setCustomTopic(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomTopic();
                          }
                        }}
                        className="w-full h-12 px-4 rounded-xl text-[14px] font-medium text-[var(--foreground)] border border-[var(--border)] outline-none transition-all duration-150 bg-transparent focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 placeholder:text-[var(--muted-foreground)]/50"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomTopic}
                        disabled={!customTopic.trim()}
                        className="px-6 h-12 rounded-xl bg-[var(--muted)] hover:bg-indigo-500/10 hover:text-indigo-500 text-sm font-bold text-[var(--foreground)] transition-colors border border-[var(--border)] disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </motion.div>

                {/* Resume (Only for Mock Interview) */}
                <AnimatePresence mode="wait">
                  {mode === "interview" && (
                    <motion.div key="resume" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-8 overflow-hidden">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3 block mt-2">
                        Resume / DAF <span className="opacity-60 normal-case tracking-normal">(Optional — enables personalised questions)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        onDragEnter={() => setIsDragging(true)}
                        onDragLeave={() => setIsDragging(false)}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragging(false);
                          const f = e.dataTransfer.files?.[0];
                          if (f?.type === "application/pdf") setResumeFile(f);
                        }}
                        className="w-full rounded-3xl py-10 px-8 text-center transition-all duration-200 border-none outline-none cursor-pointer"
                        style={{
                          background:  isDragging ? "rgba(99,102,241,0.08)" : "var(--card)",
                          boxShadow: isDragging ? "inset 0 0 0 2px rgba(99,102,241,0.4)" : "none"
                        }}
                      >
                        {resumeFile ? (
                          <div className="flex items-center justify-center gap-4">
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-500">
                              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <div className="text-left">
                              <div className="text-[17px] font-bold text-[var(--foreground)] truncate max-w-[300px]">{resumeFile.name}</div>
                              <div className="text-sm font-medium text-emerald-500 mt-1">Ready · Custom questions enabled</div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--muted)] text-[var(--muted-foreground)]">
                              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                            </div>
                            <p className="text-[16px] font-medium text-[var(--muted-foreground)]">Drop PDF here or <span className="text-indigo-500 font-bold">browse</span></p>
                            <p className="text-xs font-medium text-[var(--muted-foreground)]/60 mt-2">PDF only · Max 12 MB</p>
                          </div>
                        )}
                      </button>
                      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
                        onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)} />
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-center justify-between">
                  <button onClick={() => setStep(1)} className="flex items-center gap-2 text-[15px] font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors outline-none border-none bg-transparent cursor-pointer">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                  </button>
                  <motion.button
                    whileHover={canStep2 ? { y: -1 } : {}}
                    whileTap={canStep2 ? { scale: 0.98 } : {}}
                    onClick={() => canStep2 && setStep(3)}
                    disabled={!canStep2}
                    className="flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-[15px] text-white bg-indigo-600 disabled:opacity-40 transition-opacity outline-none border-none cursor-pointer"
                  >
                    Continue
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Settings + Review ──────────────────────────────── */}
            {step === 3 && (
              <motion.div key="s3" variants={slideVariants} custom={1}
                initial="enter" animate="center" exit="exit" transition={spring}>

                <div className="mb-8">
                  <span className="inline-block px-3 py-1 bg-indigo-500/10 text-indigo-500 rounded-full text-xs font-bold uppercase tracking-wider mb-4">Step 3 of 3 · Configure</span>
                  <h1 className="text-4xl md:text-5xl font-black tracking-tight text-[var(--foreground)] mb-3">
                    Session settings
                  </h1>
                  <p className="text-lg text-[var(--muted-foreground)]">
                    Fine-tune before entering the board room.
                  </p>
                </div>

                {/* Settings grid */}
                <div className="p-8 mb-6 rounded-3xl bg-[var(--card)] shadow-lg">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {mode === "interview" && (
                      <Select label="Duration" value={durationMins} onChange={setDurationMins}
                        options={[
                          { value: "20", label: "20 min · Quick" },
                          { value: "40", label: "40 min · Standard" },
                          { value: "60", label: "60 min · Full" },
                        ]} />
                    )}
                    <Select label="Difficulty" value={difficulty} onChange={setDifficulty}
                      options={[
                        { value: "Easy",     label: "Easy" },
                        { value: "Moderate", label: "Moderate" },
                        { value: "Hard",     label: "Hard · Stress Test" },
                      ]} />
                    <Select label="Language" value={language} onChange={setLanguage}
                      options={[
                        { value: "English",  label: "English" },
                        { value: "Hinglish", label: "Hinglish" },
                        { value: "Hindi",    label: "Hindi" },
                      ]} />
                  </div>
                </div>

                {/* Review */}
                <div className="p-8 mb-10 rounded-3xl bg-[var(--card)] shadow-lg">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-4 block">Session Preview</label>
                  <div className="flex flex-col gap-5">
                    {[
                      { k: "Domain",     v: `${selectedDomain?.icon} ${selectedDomain?.label}` },
                      { k: "Mode",       v: mode === "interview" ? "Mock Interview" : "AI Coach" },
                      { k: "Name",       v: name },
                      ...(targetYear ? [{ k: "Target Year", v: targetYear }] : []),
                      // Show combined topics if any exist
                      ...(topics.length > 0 ? [{ k: "Topics", v: topics.join(", ") }] : []),
                      ...(resumeFile && mode === "interview" ? [{ k: "Resume",     v: resumeFile.name }] : []),
                      { k: "Difficulty", v: difficulty },
                      { k: "Language",   v: language },
                      ...(mode === "interview" ? [{ k: "Duration", v: `${durationMins} minutes` }] : []),
                    ].map(({ k, v }, index, arr) => (
                      <div key={k} className={`flex items-center justify-between ${index !== arr.length -1 ? "pb-5 border-b border-[var(--border)]" : ""}`}>
                        <span className="text-[15px] font-medium text-[var(--muted-foreground)]">{k}</span>
                        <span className="text-[16px] font-bold text-[var(--foreground)]">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <button onClick={() => setStep(2)} className="flex items-center gap-2 text-[15px] font-bold text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors outline-none border-none bg-transparent cursor-pointer">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                  </button>

                  <motion.button
                    whileHover={!submitting ? { y: -1, scale: 1.02 } : {}}
                    whileTap={!submitting ? { scale: 0.98 } : {}}
                    onClick={handleStart}
                    disabled={submitting}
                    className="flex items-center gap-2.5 px-10 py-5 rounded-2xl font-black text-[17px] text-white bg-indigo-600 disabled:opacity-50 transition-all outline-none border-none cursor-pointer shadow-[0_8px_20px_rgba(99,102,241,0.3)]"
                  >
                    {submitting ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Launching...
                      </>
                    ) : (
                      <>
                        Enter Board Room
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </main>
    </>
  );
}