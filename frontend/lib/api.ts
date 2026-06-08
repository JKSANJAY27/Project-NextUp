import axios from "axios";
import { useAppStore } from "./store";

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

export default api;
