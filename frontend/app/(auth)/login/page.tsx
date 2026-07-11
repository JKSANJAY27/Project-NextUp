"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { deriveKey, exportKeyToHex } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import { ALLOWED_GOOGLE_DOMAIN } from "@/lib/auth-utils";
import api from "@/lib/api";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import CrowdCanvas from "@/components/CrowdCanvas";
import GoogleAuthButton from "@/components/GoogleAuthButton";

async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function LoginPage() {
  const router = useRouter();
  const { setToken, setUser, setEncryptionKey } = useAppStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Surface errors passed back via redirects (Google domain check, expired session)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get("error");
    if (errParam === "domain") {
      setError(`Only @${ALLOWED_GOOGLE_DOMAIN} Google accounts can be used. Please choose your college account.`);
    } else if (errParam === "session_expired") {
      setError("Your session expired. Please sign in again.");
    }
    if (errParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);

    try {
      // Derive the encryption key in-memory from the password
      const emailSalt = await getDeterministicSalt(email);
      const key = await deriveKey(password, emailSalt);
      const keyHex = await exportKeyToHex(key);

      // Login via Supabase Auth
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        throw loginError;
      }

      const access_token = data.session?.access_token;
      if (!access_token) {
        throw new Error("Failed to retrieve authentication token. Please try again.");
      }

      // Store key and token in Zustand (in-memory)
      setToken(access_token);
      setEncryptionKey(key, keyHex);

      // Load user profile
      const userRes = await api.get("/users/me");
      setUser(userRes.data);

      router.push("/dashboard");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Login failed:", err);
      const msg = err.message || "";
      if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("credentials")) {
        setError("Incorrect email or password. Please check and try again.");
      } else if (msg.toLowerCase().includes("email not confirmed")) {
        setError("Please verify your email address before signing in.");
      } else {
        setError(msg || "Sign in failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Visual panel */}
      <section className="relative overflow-hidden flex flex-col justify-between border-b-2 border-border p-8 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-16">
        <div className="relative z-10 flex flex-col items-start gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-black transition-colors">
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <Link href="/" className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
            NEXTUP.AI
          </Link>
        </div>
        <div className="relative z-10 my-16 space-y-4">
          <div className="text-[clamp(2.5rem,6vw,5.5rem)] font-extrabold tracking-tighter uppercase leading-[0.8]">
            WELCOME
            <br />
            BACK
          </div>
          <p className="max-w-md text-sm font-medium tracking-tight leading-snug">
            Sign in to see your latest shortlists, track your applications, and manage your placement calendar.
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

      {/* Login panel */}
      <section className="flex flex-col justify-center p-8 md:w-1/2 md:p-16 lg:p-24">
        <div className="max-w-md w-full mx-auto space-y-10">
          <div className="space-y-4">
            <h1 className="text-4xl font-extrabold tracking-tighter uppercase leading-none">
              Sign In
            </h1>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Enter your college email and password
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-500 tracking-wider"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                College Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@vit.ac.in"
                autoComplete="email"
                className="w-full h-14 border-b-2 border-border bg-transparent text-lg font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="login-password" className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-bold tracking-widest text-muted-foreground hover:text-accent underline transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="w-full h-14 border-b-2 border-border bg-transparent text-lg font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-accent transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center h-14 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? "Signing you in..." : "Sign In"}
            </button>
          </form>

          <GoogleAuthButton
            label="Sign in with Google"
            onError={(msg) => setError(msg)}
          />

          <div className="text-center">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Don&apos;t have an account?{" "}
              <Link
                href="/register"
                className="text-foreground hover:text-accent underline transition-colors"
              >
                Create one for free
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
