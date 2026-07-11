import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAppStore } from "./store";
import { supabase } from "./supabase";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to automatically add authorization JWT token and client decryption key
api.interceptors.request.use(
  (config) => {
    const state = useAppStore.getState();

    if (state.token) {
      config.headers.Authorization = `Bearer ${state.token}`;
    }

    if (state.encryptionKeyHex) {
      config.headers["X-Client-Key"] = state.encryptionKeyHex;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: on 401, try refreshing the Supabase session once and
// retry the request; if refresh fails the session is truly dead, so clear
// state and send the user to the sign-in page instead of failing silently.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && data.session) {
          useAppStore.getState().setToken(data.session.access_token);
          original.headers.Authorization = `Bearer ${data.session.access_token}`;
          return api(original);
        }
      } catch {
        // fall through to sign-out below
      }

      useAppStore.getState().logout();
      await supabase.auth.signOut().catch(() => {});
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?error=session_expired";
      }
    }

    return Promise.reject(error);
  }
);

export default api;
