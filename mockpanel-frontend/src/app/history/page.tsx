"use client";

// app/history/page.tsx
// Premium History & Progress Page

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import { sessionAPI, type Session } from "@/lib/api";

type Domain = "upsc" | "psu" | "sde";

const DOMAINS = [
  {
    id: "upsc" as Domain,
    icon: "⚖️",
    accent: "#f59e0b",
    accentBg: "rgba(245,158,11,0.1)",
  },
  {
    id: "psu" as Domain,
    icon: "🏭",
    accent: "#10b981",
    accentBg: "rgba(16,185,129,0.1)",
  },
  {
    id: "sde" as Domain,
    icon: "⚡",
    accent: "#6366f1",
    accentBg: "rgba(99,102,241,0.1)",
  },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    created:          { label: "Created",   cls: "text-zinc-500 bg-zinc-100 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700" },
    active:           { label: "Active",    cls: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20" },
    completed:        { label: "Completed", cls: "text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-500/10 dark:border-indigo-500/20" },
    analyzing:        { label: "Analyzing", cls: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20" },
    aborted_too_short:{ label: "Too Short", cls: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20" },
    failed:           { label: "Failed",    cls: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20" },
  };
  const cfg = map[status] || { label: status, cls: "text-zinc-500 bg-zinc-100 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700" };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// 🔥 UPDATE: Added onDelete prop
function SessionCard({ session, onClick, onDelete }: { session: Session; onClick: () => void; onDelete: (e: React.MouseEvent) => void }) {
  const domain = DOMAINS.find(d => d.id === session.domain);
  const date = new Date(session.created_at).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="group w-full text-left bg-[var(--card)] hover:bg-[var(--muted)] border border-[var(--border)] rounded-2xl px-6 py-5 flex items-center gap-5 transition-all duration-200 shadow-sm cursor-pointer relative"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
        style={{ background: domain?.accentBg || "var(--muted)" }}
      >
        {domain?.icon || "📋"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1.5">
          <span
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: domain?.accent || "var(--muted-foreground)" }}
          >
            {session.domain.toUpperCase()}
          </span>
          <span className="text-[var(--muted-foreground)] opacity-50">·</span>
          <StatusBadge status={session.status} />
        </div>
        <p className="text-[15px] text-[var(--foreground)] truncate font-bold">
          Session #{session.session_id.slice(0, 8).toUpperCase()}
        </p>
        <p className="text-[12px] text-[var(--muted-foreground)] mt-1">{date}</p>
      </div>
      
      {/* 🔥 UPDATE: Delete Button */}
      <div className="flex items-center gap-2">
        <button
          onClick={onDelete}
          title="Delete Session"
          className="p-2 text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors z-10"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        <svg
          className="w-5 h-5 text-[var(--muted-foreground)] group-hover:text-[var(--brand)] transition-colors flex-shrink-0"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl px-6 py-5 flex items-center gap-5 animate-pulse">
      <div className="w-12 h-12 rounded-xl bg-[var(--muted)] flex-shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="h-3 w-32 bg-[var(--muted)] rounded" />
        <div className="h-4 w-48 bg-[var(--muted)] rounded" />
      </div>
    </div>
  );
}

function HistoryContent() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    try {
      const data = await sessionAPI.getSessions();
      setSessions(data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleSessionClick = (session: Session) => {
    if (session.status === "completed") {
      router.push(`/results/${session.session_id}`);
    } else {
      router.push(`/interview/${session.session_id}`);
    }
  };

  // 🔥 NEW: Individual Delete Handler
  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    const confirmed = window.confirm("Are you sure you want to delete this session?");
    if (!confirmed) return;

    try {
      // Assuming your API has this method (see Step 2 below)
      await sessionAPI.deleteSession(id); 
      setSessions(prev => prev.filter(s => s.session_id !== id));
    } catch (err) {
      console.error("Failed to delete session", err);
      alert("Failed to delete session. Please try again.");
    }
  };

  // 🔥 NEW: Delete All Handler
  const handleDeleteAll = async () => {
    const confirmed = window.confirm("🚨 Are you sure you want to delete ALL sessions? This cannot be undone.");
    if (!confirmed) return;

    try {
      // Assuming your API has this method
      await sessionAPI.deleteAllSessions(); 
      setSessions([]);
    } catch (err) {
      console.error("Failed to clear history", err);
      alert("Failed to clear history. Please try again.");
    }
  };

  return (
    <div className="min-h-screen text-[var(--foreground)] pb-24 pt-12">
      <main className="max-w-4xl mx-auto px-6">
        
        <div className="mb-12">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[var(--foreground)] mb-2">
            History & Progress
          </h1>
          <p className="text-[var(--muted-foreground)] text-lg">
            Review your past mock interviews and track your improvement.
          </p>
        </div>

        {/* 🟢 Top Stats Section */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-12">
           <div className="p-5 rounded-3xl bg-[var(--card)] border border-[var(--border)] shadow-sm">
               <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-bold mb-2">Total Interviews</p>
               <p className="text-3xl font-black">{loading ? "-" : sessions.length}</p>
           </div>
           <div className="p-5 rounded-3xl bg-[var(--card)] border border-[var(--border)] shadow-sm">
               <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-bold mb-2">Avg Score</p>
               <p className="text-3xl font-black">--<span className="text-lg font-medium text-[var(--muted-foreground)]">/100</span></p>
           </div>
           <div className="p-5 rounded-3xl bg-[var(--card)] border border-[var(--border)] shadow-sm hidden md:block">
               <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)] font-bold mb-2">Status</p>
               <p className="text-lg font-bold text-emerald-500 mt-2">On Track 🚀</p>
           </div>
        </div>

        {/* 🟢 Sessions List */}
        <div>
          <div className="flex items-center justify-between mb-5 px-2">
            <h2 className="text-[13px] uppercase tracking-wider text-[var(--muted-foreground)] font-bold">
              Recent Sessions
            </h2>
            {/* 🔥 UPDATE: Clear All Button */}
            {!loading && sessions.length > 0 && (
              <button 
                onClick={handleDeleteAll}
                className="text-[12px] font-bold text-red-500 hover:text-red-600 hover:underline transition-all"
              >
                Clear All History
              </button>
            )}
          </div>
          
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20 rounded-3xl border border-dashed border-[var(--border)] bg-[var(--card)]/50">
              <div className="w-16 h-16 bg-[var(--muted)] rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">👻</span>
              </div>
              <p className="text-[16px] font-bold text-[var(--foreground)] mb-1">It's quiet here...</p>
              <p className="text-[14px] text-[var(--muted-foreground)] mb-6">You haven't taken any mock interviews yet.</p>
              <button 
                onClick={() => router.push('/dashboard')}
                className="px-6 py-2.5 bg-[var(--brand)] text-white rounded-xl font-semibold hover:opacity-90 transition-opacity"
              >
                Start an Interview
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map(s => (
                <SessionCard
                  key={s.session_id}
                  session={s}
                  onClick={() => handleSessionClick(s)}
                  onDelete={(e) => handleDeleteSession(s.session_id, e)} // 🔥 Pass event
                />
              ))}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <ProtectedRoute>
      <HistoryContent />
    </ProtectedRoute>
  );
}