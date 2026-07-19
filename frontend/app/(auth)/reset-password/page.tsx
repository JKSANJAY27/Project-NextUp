"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { deriveKey, exportKeyToHex, encryptData } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { Eye, EyeOff, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import CrowdCanvas from "@/components/CrowdCanvas";
import Logo from "@/components/Logo";

async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const { setToken, setUser, setEncryptionKey } = useAppStore();

  const [initializing, setInitializing] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Critical recovery failure states
  const [tempState, setTempState] = useState<{
    token: string;
    key: CryptoKey;
    keyHex: string;
    newNeoIdEnc: string;
  } | null>(null);
  const [vaultResetError, setVaultResetError] = useState("");
  const [vaultResetPending, setVaultResetPending] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
        setAuthenticated(true);
        setUserEmail(session.user.email || "");
      } else {
        setAuthenticated(false);
      }
      setInitializing(false);
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        setAuthenticated(true);
        setUserEmail(session.user.email || "");
      } else {
        setAuthenticated(false);
      }
      setInitializing(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password || !confirmPassword) {
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

    let derivedKey: CryptoKey | null = null;
    let keyHexStr = "";
    let newNeoIdEncStr = "";
    let currentToken = "";

    try {
      // 1. Derive new key and salt locally BEFORE updating supabase auth,
      // so if key derivation fails for any reason, the password isn't updated.
      const emailSalt = await getDeterministicSalt(userEmail);
      derivedKey = await deriveKey(password, emailSalt);
      keyHexStr = await exportKeyToHex(derivedKey);
      newNeoIdEncStr = await encryptData("", derivedKey);

      // 2. Update Supabase Auth Password
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        throw updateError;
      }

      // Retrieve new JWT token
      const session = (await supabase.auth.getSession()).data.session;
      currentToken = session?.access_token || "";
      if (!currentToken) {
        throw new Error("Could not fetch new access token from session.");
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Auth password update or crypto derivation failed:", err);
      setError(err.message || "FAILED TO UPDATE PASSWORD. TRY AGAIN.");
      setLoading(false);
      return;
    }

    // 3. Perform backend Reset Vault.
    // If this backend step fails, we enter the blocking recovery state.
    try {
      // Save credentials in Zustand first to let request interceptor pick them up
      setToken(currentToken);
      setEncryptionKey(derivedKey, keyHexStr);

      const res = await api.post("/users/reset-vault", {
        new_neo_id_enc: newNeoIdEncStr,
      });

      setUser(res.data);
      router.push("/profile");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("FastAPI reset-vault call failed after password update:", err);
      // Save the state to allow manual retries
      setTempState({
        token: currentToken,
        key: derivedKey,
        keyHex: keyHexStr,
        newNeoIdEnc: newNeoIdEncStr,
      });
      setVaultResetError(
        err.response?.data?.detail || err.message || "Failed to update vault records on database server."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRetryVaultReset = async () => {
    if (!tempState) return;
    setVaultResetPending(true);
    setVaultResetError("");

    try {
      // Set Zustand store credentials
      setToken(tempState.token);
      setEncryptionKey(tempState.key, tempState.keyHex);

      const res = await api.post("/users/reset-vault", {
        new_neo_id_enc: tempState.newNeoIdEnc,
      });

      setUser(res.data);
      setTempState(null); // Clear blocking screen
      router.push("/profile");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Vault reset retry failed:", err);
      setVaultResetError(
        err.response?.data?.detail || err.message || "Failed to reset vault on the backend database. Please retry."
      );
    } finally {
      setVaultResetPending(false);
    }
  };

  // 1. Rendering Blocking Recovery state
  if (tempState) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-black p-4 text-white">
        <div className="max-w-xl w-full border-4 border-red-600 bg-zinc-950 p-8 shadow-[8px_8px_0px_0px_#dc2626] space-y-6">
          <div className="flex items-center space-x-3 text-red-600">
            <AlertTriangle size={48} className="animate-pulse" />
            <h1 className="text-2xl font-black tracking-tighter uppercase leading-none">
              VAULT RESET PENDING
            </h1>
          </div>

          <div className="space-y-4 text-sm text-zinc-300">
            <p className="font-bold text-red-500 uppercase tracking-wide">
              WARNING: YOUR PASSWORD HAS BEEN CHANGED SUCCESSFULLY, BUT THE DATABASE VAULT CLEANUP FAILED.
            </p>
            <p>
              Because your dashboard utilizes client-side end-to-end encryption, your account is currently in an inconsistent state. You will not be able to decrypt past entries or verify your profile until the vault reset is processed.
            </p>
            <p>
              Please click the button below to retry the database vault reset. Do not close this browser tab.
            </p>
          </div>

          {vaultResetError && (
            <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-500 uppercase tracking-wider flex items-start space-x-2">
              <XCircle size={16} className="mt-0.5 shrink-0" />
              <span>ERROR: {vaultResetError}</span>
            </div>
          )}

          <button
            onClick={handleRetryVaultReset}
            disabled={vaultResetPending}
            className="flex w-full items-center justify-center h-16 border-2 border-red-600 bg-red-600 text-white font-extrabold tracking-widest uppercase hover:bg-red-700 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            {vaultResetPending ? "RETRIES IN PROGRESS..." : "RETRY VAULT RESET"}
          </button>
        </div>
      </main>
    );
  }

  // 2. Rendering initializing state
  if (initializing) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
        <div className="text-center space-y-4">
          <div className="h-12 w-12 border-4 border-t-accent border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            VALIDATING RECOVERY SESSION...
          </p>
        </div>
      </main>
    );
  }

  // 3. Rendering unauthenticated / expired link state
  if (!authenticated) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4">
        <div className="max-w-md w-full border-2 border-border p-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] text-center space-y-6">
          <div className="text-red-500 flex justify-center">
            <XCircle size={64} />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tighter uppercase">
            INVALID OR EXPIRED LINK
          </h2>
          <p className="text-sm font-medium uppercase text-muted-foreground leading-snug">
            Your password reset token has expired or is invalid. Please request a new recovery link.
          </p>
          <Link
            href="/forgot-password"
            className="flex items-center justify-center h-14 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 transition-all"
          >
            REQUEST NEW LINK
          </Link>
        </div>
      </main>
    );
  }

  // 4. Standard reset page layout
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      {/* Visual info panel */}
      <section className="relative overflow-hidden flex flex-col justify-between border-b-2 border-border p-8 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-16">
        <div className="relative z-10">
          <Link href="/" className="flex items-center">
            <Logo size="md" onAccent />
          </Link>
        </div>
        <div className="relative z-10 my-16 space-y-6">
          <div className="text-[clamp(2.2rem,5vw,4.5rem)] font-extrabold tracking-tighter uppercase leading-[0.8] text-red-700">
            WARNING:
            <br />
            VAULT
            <br />
            RESET
            <br />
            REQUIRED
          </div>

          <div className="space-y-4 uppercase">
            {/* Erasure Alert Card */}
            <div className="border-2 border-red-700 bg-red-50 p-4 text-xs font-bold text-red-950 space-y-2">
              <span className="flex items-center gap-1.5 text-red-700 font-extrabold">
                <AlertTriangle size={16} /> PERMANENTLY ERASED
              </span>
              <ul className="list-disc pl-4 space-y-1 font-semibold text-zinc-800 normal-case">
                <li>All uploaded resumes and extracted JSON records</li>
                <li>Tailored resumes generated for opportunities</li>
                <li>Personal application log notes & files</li>
                <li>University identification (Neo ID)</li>
                <li>AI toolkit evidence, skill patches & caches</li>
              </ul>
            </div>

            {/* Intact Card */}
            <div className="border-2 border-green-700 bg-green-50 p-4 text-xs font-bold text-green-950 space-y-2">
              <span className="flex items-center gap-1.5 text-green-700 font-extrabold">
                <CheckCircle2 size={16} /> REMAINS INTACT
              </span>
              <ul className="list-disc pl-4 space-y-1 font-semibold text-zinc-800 normal-case">
                <li>Your college email login account</li>
                <li>Academic profile metadata (CGPA, marks, branch)</li>
                <li>Placement opportunities drive tracking logs</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <span className="text-xs font-bold tracking-widest uppercase text-red-900">
            ⚠️ LOSS OF DECRYPTION KEY
          </span>
        </div>

        {/* Animated Crowd Canvas */}
        <CrowdCanvas src="/images/peeps/all-peeps.png" rows={15} cols={7} />
      </section>

      {/* Password Form side panel */}
      <section className="flex flex-col justify-center p-8 md:w-1/2 md:p-16 lg:p-24">
        <div className="max-w-md w-full mx-auto space-y-12">
          <div className="space-y-4">
            <h2 className="text-4xl font-extrabold tracking-tighter uppercase leading-none">
              SET NEW PASSWORD
            </h2>
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              Securely derive new vault encryption key
            </p>
          </div>

          {error && (
            <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-600 uppercase tracking-wider">
              ERROR: {error}
            </div>
          )}

          <form onSubmit={handleResetPassword} className="space-y-8">
            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                NEW PASSWORD
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-16 border-b-2 border-border bg-transparent text-xl font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-accent transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                CONFIRM NEW PASSWORD
              </label>
              <input
                type={showPassword ? "text" : "password"}
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
              className="flex w-full items-center justify-center h-16 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-red-600 hover:text-white hover:border-red-600 hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? "DERIVING NEW VAULT KEY..." : "RESET VAULT & PASSWORD"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
