"use client";

// context/AuthContext.tsx
// ════════════════════════════════════════════════════════════════════════════════
// GLOBAL AUTH STATE
// - Validates stored token on app load via /api/v1/auth/me
// - login() saves token + redirects to dashboard
// - logout() clears everything + redirects to login
// - isLoading prevents flash of unauthenticated content
// ════════════════════════════════════════════════════════════════════════════════

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { setAuthToken, clearAuthToken } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id:    string;
  email: string;
  name:  string;
}

interface AuthContextValue {
  user:      AuthUser | null;
  isLoading: boolean;
  login:     (token: string, user: AuthUser) => void;
  logout:    () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ── Storage keys ──────────────────────────────────────────────────────────────
const TOKEN_KEY   = "mockpanel_token";
const USER_KEY    = "mockpanel_user";

// ── Provider ──────────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Validate token on every app load
  useEffect(() => {
    const validateSession = async () => {
      const token     = localStorage.getItem(TOKEN_KEY);
      const userJson  = localStorage.getItem(USER_KEY);

      if (!token) {
        setIsLoading(false);
        return;
      }

      // Optimistically restore from localStorage to avoid flash
      if (userJson) {
        try {
          setUser(JSON.parse(userJson));
        } catch (_) {}
      }

      // Then validate with backend
      try {
        const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
        const res = await fetch(`${API}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data: { user_id: string; email: string; name: string } = await res.json();
          const validUser: AuthUser = {
            id:    data.user_id,
            email: data.email,
            name:  data.name,
          };
          setUser(validUser);
          localStorage.setItem(USER_KEY, JSON.stringify(validUser));
        } else {
          // Token invalid/expired — clear everything
          _clearStorage();
          setUser(null);
        }
      } catch (_) {
        // Network error — keep user logged in (offline tolerance)
        // Don't clear the stored user on network failure
      } finally {
        setIsLoading(false);
      }
    };

    validateSession();
  }, []);

  const _clearStorage = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearAuthToken();
  };

  const login = useCallback((token: string, userData: AuthUser) => {
    setAuthToken(token);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
    setUser(userData);
    router.push("/dashboard");
  }, [router]);

  const logout = useCallback(() => {
    _clearStorage();
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}