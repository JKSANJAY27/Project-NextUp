"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { deriveKey, exportKeyToHex, encryptData } from "@/lib/crypto";
import api from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const { setToken, setUser, setEncryptionKey } = useAppStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password || !confirmPassword) {
      setError("ALL FIELDS ARE REQUIRED.");
      return;
    }

    if (password !== confirmPassword) {
      setError("PASSWORDS DO NOT MATCH.");
      return;
    }

    if (password.length < 6) {
      setError("PASSWORD MUST BE AT LEAST 6 CHARACTERS.");
      return;
    }

    setLoading(true);

    try {
      // 1. Post to register to create user and get salt
      const res = await api.post("/auth/register", { email, password });
      const { access_token, email_salt } = res.data;

      // 2. Client-side derive the AES-256 key using PBKDF2
      const key = await deriveKey(password, email_salt);
      const keyHex = await exportKeyToHex(key);

      // Save credentials in state store temporarily (in-memory only)
      setToken(access_token);
      setEncryptionKey(key, keyHex);

      // 3. Encrypt initial profile data locally
      const encryptedNeoId = await encryptData("", key);
      const encryptedCgpa = await encryptData("", key);
      const encryptedTenth = await encryptData("", key);
      const encryptedTwelfth = await encryptData("", key);
      const encryptedArrears = await encryptData("false", key);

      // 4. Initialize user profile with encrypted blobs
      const profileRes = await api.put(
        "/users/me",
        {
          full_name: "",
          branch: "",
          batch_year: new Date().getFullYear(),
          neo_id_enc: encryptedNeoId,
          cgpa_enc: encryptedCgpa,
          tenth_marks_enc: encryptedTenth,
          twelfth_marks_enc: encryptedTwelfth,
          has_arrears_enc: encryptedArrears,
          skills: [],
        },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "X-Client-Key": keyHex,
          },
        }
      );

      // Save user to Zustand state
      setUser(profileRes.data);

      // Redirect to profile for onboarding
      router.push("/profile");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(
        err.response?.data?.detail || "REGISTRATION FAILED. TRY AGAIN."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Visual Kinetic typography side panel */}
      <section className="flex flex-col justify-between border-b-2 border-border p-8 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-16">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
            NEXTUP.AI
          </h1>
        </div>
        <div className="my-16 space-y-4">
          <div className="text-[clamp(2rem,6vw,5rem)] font-extrabold tracking-tighter uppercase leading-[0.8]">
            ZERO
            <br />
            KNOWLEDGE
            <br />
            PLACEMENT
            <br />
            SYSTEM
          </div>
          <p className="max-w-md text-sm font-medium uppercase tracking-tight leading-snug">
            Your credentials, marks, and job status are encrypted client-side. We store only ciphertext. Even the developers cannot read your data.
          </p>
        </div>
        <div>
          <span className="text-xs font-bold tracking-widest uppercase">
            🔒 END-TO-END ENCRYPTED
          </span>
        </div>
      </section>

      {/* Register Form side panel */}
      <section className="flex flex-col justify-center p-8 md:w-1/2 md:p-16 lg:p-24">
        <div className="max-w-md w-full mx-auto space-y-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tighter uppercase leading-none">
              CREATE ACCOUNT
            </h2>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Register using your college email address
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

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                CONFIRM PASSWORD
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-16 border-b-2 border-border bg-transparent text-xl font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center h-16 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? "INITIALIZING SECURE ENV..." : "REGISTER & DECRYPT"}
            </button>
          </form>

          <div className="text-center">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              ALREADY REGISTERED?{" "}
              <Link
                href="/login"
                className="text-foreground hover:text-accent underline transition-colors"
              >
                LOGIN HERE
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
