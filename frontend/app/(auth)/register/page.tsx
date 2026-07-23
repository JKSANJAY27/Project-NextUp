"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { deriveKey, exportKeyToHex, encryptData } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { Eye, EyeOff, ExternalLink, ArrowLeft } from "lucide-react";
import CrowdCanvas from "@/components/CrowdCanvas";
import TermsModal from "@/components/TermsModal";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import Logo from "@/components/Logo";

async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function RegisterPage() {
  const router = useRouter();
  const { setToken, setUser, setEncryptionKey } = useAppStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Terms modal state
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Inline validation state
  const [passwordStrength, setPasswordStrength] = useState<"" | "weak" | "ok" | "strong">("");

  const checkPasswordStrength = (pw: string) => {
    if (pw.length === 0) { setPasswordStrength(""); return; }
    if (pw.length < 6) { setPasswordStrength("weak"); return; }
    const hasUpper = /[A-Z]/.test(pw);
    const hasNum = /[0-9]/.test(pw);
    const hasSpecial = /[^A-Za-z0-9]/.test(pw);
    const strong = hasUpper && hasNum && hasSpecial && pw.length >= 10;
    setPasswordStrength(strong ? "strong" : "ok");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!email || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (!agreedToTerms) {
      setShowTermsModal(true);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please try again.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);

    try {
      // 1. Derive the AES-256 encryption key from the password
      const emailSalt = await getDeterministicSalt(email);
      const key = await deriveKey(password, emailSalt);
      const keyHex = await exportKeyToHex(key);

      // 2. Sign up via Supabase Auth
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        throw signUpError;
      }

      const access_token = data.session?.access_token;
      if (!access_token) {
        setSuccess("Account created! Please check your email for a verification link.");
        setLoading(false);
        return;
      }

      // Save credentials in state store (in-memory only)
      setToken(access_token);
      setEncryptionKey(key, keyHex);

      // 3. Encrypt initial sensitive profile data locally
      const encryptedNeoId = await encryptData("", key);

      // 4. Initialise user profile
      const profileRes = await api.put(
        "/users/me",
        {
          full_name: "New Student",
          branch: "Unknown",
          batch_year: new Date().getFullYear(),
          neo_id_enc: encryptedNeoId,
          neo_id: "",
          cgpa: 0.0,
          tenth_marks: 0.0,
          twelfth_marks: 0.0,
          has_arrears: false,
          skills: [],
        }
      );

      setUser(profileRes.data);

      // Redirect to profile for onboarding
      router.push("/profile");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Registration failed:", err);
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const strengthColor =
    passwordStrength === "strong"
      ? "bg-green-500"
      : passwordStrength === "ok"
      ? "bg-accent"
      : "bg-red-500";

  const strengthWidth =
    passwordStrength === "strong"
      ? "w-full"
      : passwordStrength === "ok"
      ? "w-2/3"
      : passwordStrength === "weak"
      ? "w-1/3"
      : "w-0";

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground md:flex-row md:h-screen md:overflow-hidden">
      {/* Terms modal */}
      <TermsModal
        open={showTermsModal}
        agreed={agreedToTerms}
        onToggle={setAgreedToTerms}
        onClose={() => setShowTermsModal(false)}
      />

      {/* Visual panel */}
      <section className="relative overflow-hidden flex flex-col justify-between border-b-2 border-border p-6 bg-accent text-black md:w-1/2 md:border-b-0 md:border-r-2 md:p-10 lg:p-12">
        <div className="relative z-10 flex flex-col items-start gap-3">
          <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-black transition-colors">
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <Link href="/" className="flex items-center">
            <Logo size="md" onAccent />
          </Link>
        </div>
        <div className="relative z-10 my-auto py-6 space-y-3">
          <div className="text-[clamp(2rem,5vw,4.5rem)] font-extrabold tracking-tighter uppercase leading-[0.85]">
            TRACK
            <br />
            YOUR
            <br />
            PLACEMENTS
          </div>
          <p className="max-w-md text-xs md:text-sm font-medium tracking-tight leading-snug">
            Create your free account and start tracking shortlists, eligibility, and applications — all in one place.
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

      {/* Register Form */}
      <section className="flex flex-col justify-center p-6 md:w-1/2 md:p-8 lg:p-10 md:overflow-y-auto">
        <div className="max-w-md w-full mx-auto space-y-4 md:space-y-5">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tighter uppercase leading-none">
              Create Account
            </h1>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Register with your VIT college email
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="border-2 border-red-600 bg-red-600/10 p-3 text-xs font-bold text-red-500 tracking-wider"
            >
              {error}
            </div>
          )}

          {success && (
            <div
              role="status"
              className="border-2 border-accent bg-accent/10 p-3 text-xs font-bold text-accent tracking-wider"
            >
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5 md:space-y-4" noValidate>
            {/* Email */}
            <div className="space-y-1">
              <label htmlFor="reg-email" className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                College Email
              </label>
              <input
                id="reg-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@vit.ac.in"
                autoComplete="email"
                className="w-full h-10 md:h-11 border-b-2 border-border bg-transparent text-sm md:text-base font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors"
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label htmlFor="reg-password" className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                Password
              </label>
              <div className="relative">
                <input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    checkPasswordStrength(e.target.value);
                  }}
                  placeholder="Min. 6 characters"
                  autoComplete="new-password"
                  className="w-full h-10 md:h-11 border-b-2 border-border bg-transparent text-sm md:text-base font-bold tracking-tight placeholder-zinc-700 focus:border-accent focus:outline-none px-2 transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-accent transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {/* Password strength indicator */}
              {passwordStrength && (
                <div className="space-y-1 pt-0.5">
                  <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${strengthColor} ${strengthWidth} transition-all duration-300`} />
                  </div>
                  <p className="text-[10px] text-muted-foreground capitalize">
                    Password strength:{" "}
                    <span className={passwordStrength === "strong" ? "text-green-500" : passwordStrength === "ok" ? "text-accent" : "text-red-500"}>
                      {passwordStrength}
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label htmlFor="reg-confirm-password" className="text-[11px] font-bold tracking-widest text-muted-foreground uppercase">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="reg-confirm-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  className={`w-full h-10 md:h-11 border-b-2 bg-transparent text-sm md:text-base font-bold tracking-tight placeholder-zinc-700 focus:outline-none px-2 transition-colors pr-10 ${
                    confirmPassword && confirmPassword !== password
                      ? "border-red-500 focus:border-red-500"
                      : confirmPassword && confirmPassword === password
                      ? "border-green-500 focus:border-green-500"
                      : "border-border focus:border-accent"
                  }`}
                />
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="text-[10px] text-red-500 font-bold">Passwords do not match</p>
              )}
            </div>

            {/* Terms agreement */}
            <div className="pt-0.5">
              <label className="flex items-start gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-yellow-400 cursor-pointer shrink-0"
                  id="terms-checkbox"
                  required
                />
                <span className="text-xs text-muted-foreground leading-snug group-hover:text-foreground transition-colors">
                  I agree to the{" "}
                  <button
                    type="button"
                    onClick={() => setShowTermsModal(true)}
                    className="text-accent underline hover:no-underline font-bold"
                  >
                    Terms of Service
                  </button>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    target="_blank"
                    className="text-accent underline hover:no-underline font-bold inline-flex items-center gap-0.5"
                  >
                    Privacy Policy <ExternalLink size={10} />
                  </Link>
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !agreedToTerms}
              className="flex w-full items-center justify-center h-10 md:h-11 border-2 border-border bg-foreground text-background font-extrabold text-xs md:text-sm tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {loading ? "Creating your account..." : "Create Account"}
            </button>
          </form>

          <GoogleAuthButton
            label="Sign up with Google"
            onBeforeStart={() => {
              if (!agreedToTerms) {
                setShowTermsModal(true);
                return false;
              }
              return true;
            }}
            onError={(msg) => setError(msg)}
          />

          <div className="text-center pt-1">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-foreground hover:text-accent underline transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
