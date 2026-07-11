"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { isAllowedCollegeEmail, ALLOWED_GOOGLE_DOMAIN } from "@/lib/auth-utils";
import { isProfileComplete } from "@/lib/profile-utils";
import api from "@/lib/api";
import type { Session } from "@supabase/supabase-js";

/**
 * Landing page for the Supabase Google OAuth redirect.
 * Waits for supabase-js to pick the session out of the URL, enforces the
 * college email domain, syncs the app store, and routes the user onward.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { setToken, setUser, logout } = useAppStore();
  const [error, setError] = useState("");
  const handled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const completeSignIn = async (session: Session) => {
      if (handled.current) return;
      handled.current = true;

      const email = session.user?.email;
      if (!isAllowedCollegeEmail(email)) {
        // hd is only a hint on the Google chooser — enforce the domain here.
        await supabase.auth.signOut();
        logout();
        router.replace("/login?error=domain");
        return;
      }

      try {
        setToken(session.access_token);
        // Backend auto-provisions the user row from the Supabase JWT.
        const userRes = await api.get("/users/me");
        if (cancelled) return;
        setUser(userRes.data);
        // The vault gate will prompt for a vault password on the next screen.
        router.replace(isProfileComplete(userRes.data) ? "/dashboard" : "/profile");
      } catch (err) {
        console.error("Failed to load profile after Google sign-in:", err);
        setError("SIGNED IN, BUT FAILED TO LOAD YOUR PROFILE. PLEASE TRY AGAIN.");
      }
    };

    // The session may already be present, or arrive via the auth event
    // once supabase-js finishes parsing the redirect URL.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) completeSignIn(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) completeSignIn(session);
    });

    // If Google/Supabase returned an error (or the user cancelled), bail out.
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthError = params.get("error_description") || hashParams.get("error_description") || params.get("error");
    const timeout = setTimeout(() => {
      if (!handled.current) {
        setError(
          oauthError
            ? `GOOGLE SIGN-IN FAILED: ${oauthError.toUpperCase()}`
            : "GOOGLE SIGN-IN TIMED OUT. PLEASE TRY AGAIN."
        );
      }
    }, oauthError ? 0 : 10000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center font-mono p-8">
      <div className="text-center space-y-6 max-w-md w-full">
        {error ? (
          <>
            <div className="border-2 border-red-600 bg-red-600/10 p-4 text-xs font-bold text-red-500 tracking-wider uppercase">
              {error}
            </div>
            <button
              onClick={() => router.replace("/login")}
              className="h-12 px-8 border-2 border-border bg-foreground text-background font-extrabold text-xs tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
            >
              BACK TO SIGN IN
            </button>
          </>
        ) : (
          <>
            <div className="h-2.5 w-24 bg-accent mx-auto animate-pulse" />
            <p className="text-xs font-bold tracking-widest uppercase">
              VERIFYING YOUR @{ALLOWED_GOOGLE_DOMAIN.toUpperCase()} ACCOUNT...
            </p>
          </>
        )}
      </div>
    </main>
  );
}
