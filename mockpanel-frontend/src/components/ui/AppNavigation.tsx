"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { AnimatePresence, motion } from "framer-motion";

// ─── Theme Logic ─────────────────────────────────────────────────────────────
type Theme = "light" | "dark";
const STORAGE_KEY = "mockpanel.theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

// ─── Icons ───────────────────────────────────────────────────────────────────
function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8Z" />
    </svg>
  );
}

// ─── Theme Toggle Component ──────────────────────────────────────────────────
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial: Theme = saved === "dark" || saved === "light" ? (saved as Theme) : "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="cursor-pointer group inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white/70 text-zinc-900 backdrop-blur-md transition hover:bg-white dark:border-white/10 dark:bg-zinc-950/60 dark:text-white dark:hover:bg-zinc-950/80 outline-none"
      title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      {theme === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}

// ─── Main Header Component ────────────────────────────────────────────────────
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isProfileHovered, setIsProfileHovered] = useState(false);

  // Layout check: don't show on interview or auth pages
  if (pathname?.startsWith("/interview") || pathname === "/login" || pathname === "/signup") return null;

  const getInitials = () => {
    if (!user?.name) return user?.email?.charAt(0).toUpperCase() || "U";
    const parts = user.name.split(" ");
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0][0].toUpperCase();
  };

  const isDashboardActive = pathname === "/dashboard";

  return (
    <header className="sticky top-0 z-50 bg-white/10 dark:bg-black/10 backdrop-blur-2xl transition-colors duration-300">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">

        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2 relative z-50">
          <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-[0_0_15px_rgba(99,102,241,0.15)] dark:border-white/10 dark:bg-white/5 dark:shadow-[0_0_18px_rgba(99,102,241,0.35)]">
            <span className="h-3 w-3 rounded-md bg-gradient-to-br from-indigo-400 to-fuchsia-400" />
          </span>
          <span className="font-semibold tracking-tight text-zinc-900 dark:text-white">MockPanel</span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-3 relative z-50">
          <ThemeToggle />

          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard"
                className={`hidden sm:inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition cursor-pointer ${
                  isDashboardActive
                    ? "bg-zinc-200/80 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-white"
                    : "bg-white/70 dark:bg-zinc-950/60 border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white"
                } backdrop-blur-md`}
              >
                Dashboard
              </Link>

              {/* Profile Hover Wrapper */}
              <div 
                className="relative" 
                onMouseEnter={() => setIsProfileHovered(true)} 
                onMouseLeave={() => setIsProfileHovered(false)}
              >
                <button
                  className={`cursor-pointer inline-flex h-10 w-10 items-center justify-center rounded-full border transition backdrop-blur-md ${
                    isProfileHovered
                      ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-indigo-600 dark:text-indigo-400"
                      : "bg-white/70 dark:bg-zinc-950/60 border-zinc-200 dark:border-white/10 text-indigo-600 dark:text-indigo-400"
                  }`}
                >
                  {getInitials()}
                </button>

                <AnimatePresence>
                  {isProfileHovered && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full pt-2 w-60 z-50"
                    >
                      <div className="rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900 overflow-hidden">
                        <div className="px-4 py-3 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-black/20">
                          <p className="text-[14px] font-bold text-zinc-900 dark:text-white truncate">{user.name || "Candidate"}</p>
                          <p className="text-[12px] text-zinc-500 dark:text-zinc-400 truncate">{user.email}</p>
                        </div>
                        <div className="p-2 flex flex-col gap-1">
                          <button onClick={() => { setIsProfileHovered(false); router.push("/history"); }} className="flex items-center gap-3 w-full px-3 py-2.5 text-[13px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-xl cursor-pointer transition-colors text-left border-none outline-none bg-transparent">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            History & Progress
                          </button>
                        </div>
                        <div className="p-2 border-t border-zinc-100 dark:border-white/5">
                          <button onClick={() => { setIsProfileHovered(false); logout(); }} className="flex items-center gap-3 w-full px-3 py-2.5 text-[13px] font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl cursor-pointer transition-colors text-left border-none outline-none bg-transparent">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            Sign Out
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="cursor-pointer inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition">Sign In</Link>
              <Link href="/login" className="cursor-pointer inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">Get Started</Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

export function AppFooter() {
  const pathname = usePathname();
  if (pathname?.startsWith("/interview")) return null;
  return (
    <footer>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
        © {new Date().getFullYear()} MockPanel
      </div>
    </footer>
  );
}