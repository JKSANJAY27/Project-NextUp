"use client";

import React, { useState } from "react";
import { signInWithGoogle, ALLOWED_GOOGLE_DOMAIN } from "@/lib/auth-utils";

interface GoogleAuthButtonProps {
  label: string;
  /** Optional pre-flight check (e.g. terms agreement). Return false to block. */
  onBeforeStart?: () => boolean;
  onError?: (message: string) => void;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.19 7.19 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

export default function GoogleAuthButton({ label, onBeforeStart, onError }: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (onBeforeStart && !onBeforeStart()) return;
    setLoading(true);
    try {
      await signInWithGoogle();
      // Browser navigates away to Google — no need to reset loading on success.
    } catch (err: unknown) {
      console.error("Google sign-in failed:", err);
      setLoading(false);
      onError?.((err as Error)?.message || "Google sign-in failed. Please try again.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="h-0.5 flex-1 bg-border" />
        <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">OR</span>
        <div className="h-0.5 flex-1 bg-border" />
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 h-14 border-2 border-border bg-transparent text-foreground font-extrabold tracking-widest uppercase hover:border-accent hover:text-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
      >
        <GoogleIcon />
        <span>{loading ? "Redirecting to Google..." : label}</span>
      </button>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-center">
        Only @{ALLOWED_GOOGLE_DOMAIN} accounts are accepted
      </p>
    </div>
  );
}
