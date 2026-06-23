"use client";

import React, { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CrowdCanvas from "@/components/CrowdCanvas";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email) {
      setError("EMAIL IS REQUIRED.");
      return;
    }

    setLoading(true);

    try {
      const redirectToUrl = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo: redirectToUrl,
        }
      );

      if (resetError) {
        throw resetError;
      }

      setSuccess(
        "PASSWORD RESET EMAIL SENT. PLEASE CHECK YOUR INBOX AND CLICK THE RECOVERY LINK."
      );
      setLoading(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Password reset request failed:", err);
      setError(err.message || "FAILED TO SEND RESET EMAIL. PLEASE TRY AGAIN.");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Visual panel */}
      <section className="relative overflow-hidden flex flex-col justify-between border-b-2 border-border p-8 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-16">
        <div className="relative z-10">
          <h1 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
            NEXTUP.AI
          </h1>
        </div>
        <div className="relative z-10 my-16 space-y-4">
          <div className="text-[clamp(2.5rem,6vw,5.5rem)] font-extrabold tracking-tighter uppercase leading-[0.8]">
            RECOVER
            <br />
            YOUR
            <br />
            SECURE
            <br />
            VAULT
          </div>
          <p className="max-w-md text-sm font-medium uppercase tracking-tight leading-snug">
            Lost your key? Let&apos;s reset your login credentials. Keep in mind that resetting your password will erase your zero-knowledge encrypted vault contents.
          </p>
        </div>
        <div className="relative z-10">
          <span className="text-xs font-bold tracking-widest uppercase">
            🔒 END-TO-END ENCRYPTED
          </span>
        </div>
        
        {/* Animated Crowd Canvas */}
        <CrowdCanvas src="/images/peeps/all-peeps.png" rows={15} cols={7} />
      </section>

      {/* Forgot Password panel */}
      <section className="flex flex-col justify-center p-8 md:w-1/2 md:p-16 lg:p-24">
        <div className="max-w-md w-full mx-auto space-y-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tighter uppercase leading-none">
              RESET PASSWORD
            </h2>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Enter your registered college email
            </p>
          </div>

          {error && (
            <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
              ERROR: {error}
            </div>
          )}

          {success && (
            <div className="border-2 border-accent bg-accent/10 p-4 text-xs font-bold text-accent uppercase tracking-wider">
              {success}
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  COLLEGE EMAIL
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="STUDENT@VIT.AC.IN"
                  className="w-full h-16 border-b-2 border-border bg-transparent text-xl font-bold uppercase tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center h-16 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {loading ? "SENDING RESET LINK..." : "SEND RECOVERY LINK"}
              </button>
            </form>
          )}

          <div className="text-center">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              REMEMBERED PASSWORD?{" "}
              <Link
                href="/login"
                className="text-foreground hover:text-accent underline transition-colors"
              >
                SIGN IN HERE
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
