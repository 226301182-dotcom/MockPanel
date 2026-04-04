"use client";

// app/login/page.tsx
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, type AuthUser } from "@/context/AuthContext";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ── Floating particle background ──────────────────────────────────────────────
function GridBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* Dot grid - adapts to theme */}
      <div
        className="absolute inset-0 opacity-[0.15] dark:opacity-[0.15] opacity-20"
        style={{
          backgroundImage: "radial-gradient(circle, var(--foreground) 1px, transparent 1px)",
          backgroundSize:  "40px 40px",
        }}
      />
      {/* Radial vignette - uses dynamic background variable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,transparent_40%,var(--background)_100%)]" />
      {/* Accent glows */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-brand/20 rounded-full blur-[100px]" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-violet-600/15 rounded-full blur-[120px]" />
    </div>
  );
}

// ── Input field ───────────────────────────────────────────────────────────────
function AuthInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
}: {
  label:         string;
  type?:         string;
  value:         string;
  onChange:      (v: string) => void;
  placeholder?:  string;
  autoComplete?: string;
  autoFocus?:    boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-[0.18em] font-semibold text-text-secondary mb-2.5">
        {label}
      </label>
      <div
        className="relative rounded-xl overflow-hidden transition-all duration-200 bg-muted border border-border"
        style={{
          boxShadow: focused
            ? "0 0 0 1px var(--brand), 0 0 20px rgba(99,102,241,0.1)"
            : "none",
        }}
      >
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="w-full bg-transparent px-4 py-3.5 text-[15px] text-foreground placeholder-muted-foreground outline-none"
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const [mode,     setMode]     = useState<"login" | "signup">("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [name,     setName]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [animIn,   setAnimIn]   = useState(true);

  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  const switchMode = (next: "login" | "signup") => {
    setAnimIn(false);
    setError("");
    setTimeout(() => {
      setMode(next);
      setAnimIn(true);
    }, 160);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");

    const endpoint = mode === "login" ? "/auth/login" : "/auth/signup";
    const body     = mode === "login"
      ? { email, password }
      : { email, password, name: name.trim() };

    try {
      const res = await fetch(`${API}${endpoint}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Something went wrong. Please try again.");
      }

      const userData: AuthUser = {
        id:    data.user_id,
        email: data.email,
        name:  data.name || email.split("@")[0],
      };

      login(data.token, userData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative transition-colors duration-300">
      <GridBackground />

      <div
        className="w-full max-w-[400px] relative z-10"
        style={{
          opacity:   animIn ? 1 : 0,
          transform: animIn ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 160ms ease, transform 160ms ease",
        }}
      >
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand to-violet-600 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.4)]">
            <span className="text-white font-black text-sm">M</span>
          </div>
          <span className="text-foreground font-bold text-lg tracking-tight">MockPanel</span>
        </div>

        {/* Card */}
        <div className="mp-card p-8 backdrop-blur-xl">
          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-xl font-bold text-foreground tracking-tight mb-1">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-text-secondary">
              {mode === "login"
                ? "Sign in to continue your interview prep."
                : "Join MockPanel. Your first session is free."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <AuthInput
                label="Full Name"
                value={name}
                onChange={setName}
                placeholder="Rahul Kumar"
                autoComplete="name"
                autoFocus
              />
            )}

            <AuthInput
              label="Email Address"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus={mode === "login"}
            />

            <AuthInput
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={mode === "signup" ? "Min. 8 characters" : "••••••••"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-600 dark:text-red-400 text-[13px] leading-relaxed">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="relative mt-1 w-full h-12 rounded-xl font-semibold text-[15px] overflow-hidden transition-all duration-200 disabled:opacity-60 text-white"
              style={{
                background:  "linear-gradient(135deg, var(--brand) 0%, #7c3aed 100%)",
                boxShadow:   loading ? "none" : "0 0 24px rgba(99,102,241,0.35)",
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>
                    {mode === "login" ? "Signing in…" : "Creating account…"}
                  </span>
                </span>
              ) : (
                <span>
                  {mode === "login" ? "Sign In" : "Create Account"}
                </span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-text-secondary uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Mode switch */}
          <p className="text-center text-[13px] text-text-secondary">
            {mode === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="text-brand hover:opacity-80 font-semibold transition-opacity"
                >
                  Sign up free
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-brand hover:opacity-80 font-semibold transition-opacity"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        {/* Footer note */}
        <p className="text-center text-[11px] text-text-secondary mt-6 leading-relaxed">
          By continuing, you agree to our{" "}
          <span className="text-foreground">Terms of Service</span> and{" "}
          <span className="text-foreground">Privacy Policy</span>.
        </p>
      </div>
    </div>
  );
}