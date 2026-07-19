"use client";

import React, { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CrowdCanvas from "@/components/CrowdCanvas";
import PasswordChangeWarningModal from "@/components/PasswordChangeWarningModal";
import { AlertTriangle } from "lucide-react";
import Logo from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // Show warning modal before sending the reset email
  const [showWarningModal, setShowWarningModal] = useState(false);

  const triggerPasswordReset = async () => {
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const redirectToUrl = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: redirectToUrl }
      );
      if (resetError) throw resetError;
      setSuccess(
        "Password reset email sent. Please check your inbox and click the recovery link."
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Password reset request failed:", err);
      setError(err.message || "Failed to send reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter your college email address.");
      return;
    }
    // Show warning first
    setShowWarningModal(true);
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Warning modal — shown before the reset email is sent */}
      <PasswordChangeWarningModal
        open={showWarningModal}
        onConfirm={() => {
          setShowWarningModal(false);
          triggerPasswordReset();
        }}
        onCancel={() => {
          setShowWarningModal(false);
        }}
      />

      {/* Visual panel */}
      <section className="relative overflow-hidden flex flex-col justify-between border-b-2 border-border p-8 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-16">
        <div className="relative z-10">
          <Link href="/" className="flex items-center">
            <Logo size="md" onAccent />
          </Link>
        </div>
        <div className="relative z-10 my-16 space-y-4">
          <div className="text-[clamp(2.5rem,6vw,5.5rem)] font-extrabold tracking-tighter uppercase leading-[0.8]">
            RECOVER
            <br />
            YOUR
            <br />
            ACCOUNT
          </div>
          <p className="max-w-md text-sm font-medium tracking-tight leading-snug">
            Reset your login password. <strong>Important:</strong> changing your password will reset
            your encrypted profile vault — you will need to re-enter your registration number, CGPA, and marks.
          </p>
        </div>
        <div className="relative z-10">
          <span className="text-xs font-bold tracking-widest uppercase">
            🔒 Your data is encrypted in your browser
          </span>
        </div>

        {/* Animated Crowd Canvas */}
        <CrowdCanvas src="/images/peeps/all-peeps.png" rows={15} cols={7} />
      </section>

      {/* Forgot Password panel */}
      <section className="flex flex-col justify-center p-8 md:w-1/2 md:p-16 lg:p-24">
        <div className="max-w-md w-full mx-auto space-y-10">
          <div className="space-y-4">
            <h1 className="text-4xl font-extrabold tracking-tighter uppercase leading-none">
              Reset Password
            </h1>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Enter your registered college email
            </p>
          </div>

          {/* Vault data warning notice */}
          <div className="flex items-start gap-3 border-2 border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-extrabold text-amber-500 uppercase tracking-wider">
                Important — Data Reset Notice
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Because your profile data (registration number, CGPA, marks) is encrypted using your password,
                changing your password will make existing encrypted data unreadable.
                You will need to re-enter this information after resetting.
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-500 tracking-wider"
            >
              {error}
            </div>
          )}

          {success && (
            <div
              role="status"
              className="border-2 border-accent bg-accent/10 p-4 text-xs font-bold text-accent tracking-wider"
            >
              {success}
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit} className="space-y-8" noValidate>
              <div className="space-y-2">
                <label
                  htmlFor="forgot-email"
                  className="text-xs font-bold tracking-widest text-muted-foreground uppercase"
                >
                  College Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@vit.ac.in"
                  autoComplete="email"
                  className="w-full h-14 border-b-2 border-border bg-transparent text-lg font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center h-14 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {loading ? "Sending reset link..." : "Send Recovery Link"}
              </button>
            </form>
          )}

          <div className="text-center">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Remembered your password?{" "}
              <Link
                href="/login"
                className="text-foreground hover:text-accent underline transition-colors"
              >
                Sign in here
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
