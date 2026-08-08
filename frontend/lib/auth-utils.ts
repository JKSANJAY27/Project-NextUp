// Shared authentication helpers used by the login/register pages,
// the Google OAuth callback, and the vault unlock gate.

import { supabase } from "@/lib/supabase";

/** Only college accounts on this domain may sign in with Google. */
export const ALLOWED_GOOGLE_DOMAIN = "vitstudent.ac.in";

export function isAllowedCollegeEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_GOOGLE_DOMAIN}`);
}

/**
 * Supabase's hosted development mailer returns a generic error when its
 * project-wide email quota is exhausted. Do not expose that implementation
 * detail to students, and do not encourage retries: retries consume the same
 * limited quota. The production fix is custom SMTP in Supabase Auth.
 */
export function getAuthErrorMessage(error: unknown, action: "signup" | "password-reset"): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("email rate limit") ||
    normalized.includes("rate limit exceeded") ||
    normalized.includes("too many requests") ||
    normalized.includes("over_email_send_rate_limit")
  ) {
    return action === "signup"
      ? "Email verification is temporarily busy. Please use Google sign-up, or try again later."
      : "Password-reset emails are temporarily busy. Please wait before trying again.";
  }

  return message || "Something went wrong. Please try again.";
}

/**
 * Deterministic per-user salt for PBKDF2 vault key derivation:
 * SHA-256 of the lowercased email, hex-encoded.
 */
export async function getDeterministicSalt(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.trim().toLowerCase());
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Starts the Google OAuth flow via Supabase.
 * `hd` restricts the Google account chooser to the college domain
 * (UI-level filter only — the callback page re-verifies the domain).
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: {
        hd: ALLOWED_GOOGLE_DOMAIN,
        prompt: "select_account",
      },
    },
  });
  if (error) throw error;
}
