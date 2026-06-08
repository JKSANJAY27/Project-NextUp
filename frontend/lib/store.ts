import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  branch: string | null;
  batch_year: number | null;
  neo_id_enc: string | null;
  cgpa_enc: string | null;
  tenth_marks_enc: string | null;
  twelfth_marks_enc: string | null;
  has_arrears_enc: string | null;
  skills: string[] | null;
  gmail_connected: boolean;
  created_at: string;
}

interface AppState {
  token: string | null;
  user: UserProfile | null;
  encryptionKey: CryptoKey | null;
  encryptionKeyHex: string | null;
  setToken: (token: string | null) => void;
  setUser: (user: UserProfile | null) => void;
  setEncryptionKey: (key: CryptoKey | null, hex: string | null) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      encryptionKey: null,
      encryptionKeyHex: null,

      setToken: (token) => set({ token }),
      setUser: (user) => set({ user }),
      setEncryptionKey: (key, hex) => set({ encryptionKey: key, encryptionKeyHex: hex }),
      
      logout: () => {
        set({
          token: null,
          user: null,
          encryptionKey: null,
          encryptionKeyHex: null,
        });
        // Clear all session storage if any
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("nextup-session");
        }
      },
    }),
    {
      name: "nextup-session",
      // Exclude encryptionKey and encryptionKeyHex from local storage persistence
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
    }
  )
);
