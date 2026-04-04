// app/layout.tsx
// ════════════════════════════════════════════════════════════════════════════════
// ROOT LAYOUT — AuthProvider wraps entire app
// Anti-flicker script for dark mode theme persistence
// ════════════════════════════════════════════════════════════════════════════════

import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import { AppHeader, AppFooter } from "@/components/ui/AppNavigation";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets:  ["latin"],
  weight:   ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title:       "MockPanel | Elite AI Mock Interviews",
  description: "Authentic board-style AI interviews for UPSC, PSU, and SDE aspirants. Real panel simulation, instant analytics.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.className} antialiased min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)] transition-colors duration-300`}
      >
        {/* Anti-flicker: restore theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem('mockpanel.theme') || 'dark';
                  if (t === 'dark') document.documentElement.classList.add('dark');
                } catch(e) {}
              })();
            `,
          }}
        />

        {/*
          AuthProvider wraps the ENTIRE app.
          useAuth() works in any client component without extra setup.
        */}
        <AuthProvider>
          <AppHeader />
          <main className="flex-1 w-full relative">
            {children}
          </main>
          <AppFooter />
        </AuthProvider>
      </body>
    </html>
  );
}