"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

/**
 * Keeps the app store in sync with the Supabase auth session.
 *
 * Supabase persists and auto-refreshes its session in localStorage, but the
 * app store used to keep its own copy of the access token that silently went
 * stale after the tab was closed. This provider makes Supabase the source of
 * truth: fresh tokens flow into the store, and if the Supabase session is
 * gone the stale store state is cleared so guards redirect to /login.
 */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const state = useAppStore.getState();
      if (session) {
        if (state.token !== session.access_token) {
          state.setToken(session.access_token);
        }
      } else if (state.token) {
        // Persisted token but no recoverable Supabase session — force re-login.
        state.logout();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const state = useAppStore.getState();
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
        if (state.token !== session.access_token) {
          state.setToken(session.access_token);
        }
      } else if (event === "SIGNED_OUT" && state.token) {
        state.logout();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return <>{children}</>;
}
