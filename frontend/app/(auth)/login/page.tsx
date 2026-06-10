"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { deriveKey, exportKeyToHex } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("EMAIL AND PASSWORD ARE REQUIRED.");
      return;
    }

    setLoading(true);

    try {
      // 1. Derive the salt deterministically from the email
      const emailSalt = await getDeterministicSalt(email);

      // 2. Derive the key in-memory
      const key = await deriveKey(password, emailSalt);
      const keyHex = await exportKeyToHex(key);

      // 3. Login via Supabase Auth
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        throw loginError;
      }

      const access_token = data.session?.access_token;
      if (!access_token) {
        throw new Error("Failed to retrieve authentication token.");
      }

      // Store key and token in Zustand
      setToken(access_token);
      setEncryptionKey(key, keyHex);

      // 4. Load user profile from FastAPI backend using the Supabase JWT
      const userRes = await api.get("/users/me");

      setUser(userRes.data);

      // Redirect to dashboard
      router.push("/dashboard");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Login failed:", err);
      setError(err.message || "LOGIN FAILED. PLEASE CHECK YOUR CREDENTIALS.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Visual panel */}
      <section className="flex flex-col justify-between border-b-2 border-border p-8 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-16">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
            NEXTUP.AI
          </h1>
        </div>
        <div className="my-16 space-y-4">
          <div className="text-[clamp(2.5rem,6vw,5.5rem)] font-extrabold tracking-tighter uppercase leading-[0.8]">
            UNLOCK
            <br />
            YOUR
            <br />
            PLACEMENT
            <br />
            VAULT
          </div>
          <p className="max-w-md text-sm font-medium uppercase tracking-tight leading-snug">
            Your encryption key is re-derived on each login. The server never receives your password or key. Enter your credentials to decrypt your dashboard.
          </p>
        </div>
        <div>
          <span className="text-xs font-bold tracking-widest uppercase">
            🔒 ZERO-KNOWLEDGE LOG IN
          </span>
        </div>
      </section>

      {/* Login panel */}
      <section className="flex flex-col justify-center p-8 md:w-1/2 md:p-16 lg:p-24">
        <div className="max-w-md w-full mx-auto space-y-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tighter uppercase leading-none">
              SIGN IN
            </h2>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Enter your college credentials
            </p>
          </div>

          {error && (
            <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
              Error: {error}
            </div>
          )}

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

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                PASSWORD
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-16 border-b-2 border-border bg-transparent text-xl font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center h-16 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? "DERIVING KEY & LOGGING IN..." : "UNSEAL VAULT"}
            </button>
          </form>

          <div className="text-center">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              NEW TO PLACEMENTOS?{" "}
              <Link
                href="/register"
                className="text-foreground hover:text-accent underline transition-colors"
              >
                CREATE ACCOUNT
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
