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
