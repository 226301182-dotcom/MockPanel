"use client";

// components/ProtectedRoute.tsx
// ════════════════════════════════════════════════════════════════════════════════
// Route guard — redirects unauthenticated users to /login
// Shows premium spinner while auth state is being determined
// ════════════════════════════════════════════════════════════════════════════════

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

interface Props {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, router]);

  // Auth check in progress
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-white/5" />
            <div className="absolute inset-0 rounded-full border-2 border-t-indigo-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
          </div>
          <span className="text-[11px] uppercase tracking-[0.25em] text-zinc-600 font-medium">
            Verifying session
          </span>
        </div>
      </div>
    );
  }

  // Not logged in — render nothing (redirect in effect above)
  if (!user) return null;

  // Logged in — render page
  return <>{children}</>;
}