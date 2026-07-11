"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { deriveKey, exportKeyToHex, decryptData, encryptData } from "@/lib/crypto";
import { getDeterministicSalt } from "@/lib/auth-utils";
import api from "@/lib/api";
import { ShieldCheck, Unlock, LogOut, Eye, EyeOff } from "lucide-react";

/**
 * Global vault gate for authenticated pages.
 *
 * The encryption key lives only in memory, so it is lost when the tab is
 * closed even though the login session survives. Instead of letting the user
 * wander into a dashboard where nothing works, this gate immediately asks for
 * the vault password (their account password for email sign-ups, or the vault
 * password chosen after Google sign-in) before rendering anything.
 */
export default function VaultGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, user, encryptionKey, setEncryptionKey, setUser, logout } = useAppStore();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Recover the profile if the token survived but the user object didn't.
  useEffect(() => {
    if (token && !user) {
      api.get("/users/me")
        .then((res) => setUser(res.data))
        .catch((err) => console.error("Failed to restore user profile:", err));
    }
  }, [token, user, setUser]);

  if (!token || encryptionKey) {
    return <>{children}</>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-bold tracking-widest uppercase font-mono">
        <div className="text-center space-y-4">
          <div className="h-2.5 w-24 bg-accent mx-auto animate-pulse" />
          <p className="text-xs">RESTORING YOUR SESSION...</p>
        </div>
      </div>
    );
  }

  // No encrypted data yet (e.g. first Google sign-in): ask the user to
  // create a vault password instead of unlocking an existing one.
  const isFirstTime = !user.neo_id_enc || user.neo_id_enc === "UNSET";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    logout();
    router.push("/login");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isFirstTime) {
      if (password.length < 6) {
        setError("VAULT PASSWORD MUST BE AT LEAST 6 CHARACTERS.");
        return;
      }
      if (password !== confirmPassword) {
        setError("PASSWORDS DO NOT MATCH.");
        return;
      }
    }

    setLoading(true);
    try {
      const emailSalt = await getDeterministicSalt(user.email);
      const key = await deriveKey(password, emailSalt);
      const keyHex = await exportKeyToHex(key);

      if (isFirstTime) {
        // Seal the vault marker so future sessions unlock with this password.
        const encryptedNeoId = await encryptData("", key);
        setEncryptionKey(key, keyHex);
        const res = await api.put("/users/me", { neo_id_enc: encryptedNeoId, neo_id: "" });
        setUser(res.data);
      } else {
        // Verify the password by decrypting the vault marker.
        try {
          await decryptData(user.neo_id_enc!, key);
        } catch {
          setError("INCORRECT PASSWORD. PLEASE TRY AGAIN.");
          setLoading(false);
          return;
        }
        setEncryptionKey(key, keyHex);
      }
    } catch (err) {
      console.error("Vault unlock failed:", err);
      setError("FAILED TO UNLOCK VAULT. PLEASE TRY AGAIN.");
      // Roll back a partial first-time setup so the gate stays consistent.
      if (isFirstTime) setEncryptionKey(null, null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center items-center bg-background text-foreground p-8">
      <div className="max-w-md w-full border-2 border-border bg-background p-8 md:p-12 space-y-8">
        <div className="space-y-4 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center bg-accent text-black border-2 border-black">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tighter uppercase leading-none">
            {isFirstTime ? "SECURE YOUR VAULT" : "WELCOME BACK"}
          </h1>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest leading-relaxed">
            {isFirstTime
              ? "Your data is encrypted in your browser. Choose a vault password — you will need it every time you open the app."
              : "You're still signed in, but your encryption key never leaves this device. Enter your password to unlock your data."}
          </p>
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">
            Signed in as <span className="text-foreground">{user.email}</span>
          </p>
        </div>

        {error && (
          <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-500 uppercase tracking-wider text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="vault-password" className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
              {isFirstTime ? "CREATE VAULT PASSWORD" : "PASSWORD"}
            </label>
            <div className="relative">
              <input
                id="vault-password"
                type={showPassword ? "text" : "password"}
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={isFirstTime ? "new-password" : "current-password"}
                className="w-full h-14 border-2 border-border bg-transparent text-xl font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-4 transition-colors pr-12"
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
            {!isFirstTime && (
              <p className="text-[10px] text-muted-foreground tracking-wider uppercase">
                Registered with email? It&apos;s your account password. Signed in with Google? It&apos;s the vault password you created.
              </p>
            )}
          </div>

          {isFirstTime && (
            <div className="space-y-2">
              <label htmlFor="vault-password-confirm" className="text-xs font-bold tracking-widest text-muted-foreground uppercase block">
                CONFIRM VAULT PASSWORD
              </label>
              <input
                id="vault-password-confirm"
                type={showPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="w-full h-14 border-2 border-border bg-transparent text-xl font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-4 transition-colors"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 h-14 border-2 border-border bg-foreground text-background font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 disabled:opacity-50"
          >
            <Unlock size={16} />
            <span>
              {loading
                ? isFirstTime ? "SECURING..." : "UNLOCKING..."
                : isFirstTime ? "SECURE VAULT" : "UNLOCK & CONTINUE"}
            </span>
          </button>
        </form>

        <button
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 text-xs font-bold tracking-widest text-muted-foreground uppercase hover:text-red-500 transition-colors"
        >
          <LogOut size={12} />
          <span>Not you? Sign out</span>
        </button>
      </div>
    </div>
  );
}
