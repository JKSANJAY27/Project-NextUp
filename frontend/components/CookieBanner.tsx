"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Cookie } from "lucide-react";

const CONSENT_KEY = "nextup-cookie-consent";

// Only show on public (non-authenticated) pages
const PUBLIC_PATHS = ["/", "/login", "/register", "/terms", "/privacy"];

export default function CookieBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isPublic = PUBLIC_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p + "/")
    );
    if (!isPublic) return;

    const consent = localStorage.getItem(CONSENT_KEY);
    if (!consent) {
      // Small delay so it doesn't flash on first render
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    setVisible(false);
  };

  const handleDismiss = () => {
    // Dismiss without full accept (banner reappears next visit)
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-50 border-t-2 border-border bg-background/95 backdrop-blur-md shadow-2xl animate-in slide-in-from-bottom duration-300"
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
        <div className="flex items-start gap-3 flex-1">
          <Cookie size={18} className="text-accent mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-foreground uppercase tracking-wider">
              We use essential cookies only
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              NEXTUP.AI uses cookies only for authentication and session management — no tracking, no ads.{" "}
              <Link
                href="/privacy"
                className="underline hover:text-accent transition-colors"
                target="_blank"
              >
                Learn more in our Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleDismiss}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss cookie banner"
          >
            <X size={16} />
          </button>
          <button
            onClick={handleAccept}
            className="px-5 h-9 bg-foreground text-background text-xs font-extrabold tracking-widest uppercase border-2 border-border hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
