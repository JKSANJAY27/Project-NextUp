"use client";

import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import CookieBanner from "@/components/CookieBanner";
import AuthProvider from "@/components/AuthProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // The backend is a free-tier instance that spins down after
        // inactivity — a cold start can take 30-50s and the first request(s)
        // fail outright (the browser reports this as an opaque CORS error
        // since it never gets a response to read headers from). retry: 1
        // gave up in ~1s, well before the instance woke, so pages like
        // Active Tracking rendered a false "no companies" empty state.
        // Client errors (4xx, auth handled separately) won't resolve by
        // retrying — only network failures / 5xx get the generous backoff.
        retry: (failureCount, error) => {
          const status = (error as AxiosError)?.response?.status;
          if (status && status >= 400 && status < 500 && status !== 429) {
            return false;
          }
          return failureCount < 5;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 15000),
      },
    },
  }));

  useEffect(() => {
    // Load theme from localStorage or default to system preference
    const savedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
      </AuthProvider>
      {/* Global cookie consent banner — only shows on public pages */}
      <CookieBanner />
    </QueryClientProvider>
  );
}
