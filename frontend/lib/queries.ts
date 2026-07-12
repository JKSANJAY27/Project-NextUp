import { useQuery } from "@tanstack/react-query";
import api from "./api";

// Cache Keys
export const CACHE_KEYS = {
  userProfile: ["user-profile"],
  dashboard: ["dashboard"],
  companies: ["companies"],
  companyDetail: (id: string) => ["company", id],
  companyEvents: (id: string) => ["company-events", id],
  applications: ["applications"],
  notifications: ["notifications"],
  announcements: ["announcements"],
  calendar: ["calendar"],
  resume: ["resume"],
};

// 1. User Profile Hook (staleTime: 5 min)
export function useUserProfile(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.userProfile,
    queryFn: async () => {
      const res = await api.get("/users/me");
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

// 1.5 Unified Dashboard Hook (staleTime: 5 min, always refetch on mount)
export function useDashboard(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.dashboard,
    queryFn: async () => {
      const res = await api.get("/dashboard");
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    enabled,
  });
}
// 2. Companies List Hook (staleTime: 5 min)
export function useCompanies(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.companies,
    queryFn: async () => {
      const res = await api.get("/companies");
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

// 3. Company Detail Hook (staleTime: 5 min)
export function useCompanyDetail(id: string | null, enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.companyDetail(id || ""),
    queryFn: async () => {
      if (!id) return null;
      const res = await api.get(`/companies/${id}`);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: enabled && !!id,
  });
}

// 4. Company Events Hook (staleTime: 5 min)
export function useCompanyEvents(id: string | null, enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.companyEvents(id || ""),
    queryFn: async () => {
      if (!id) return [];
      const res = await api.get(`/companies/${id}/events`);
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: enabled && !!id,
  });
}

// 5. Applications Tracker List Hook (staleTime: 20 sec)
export function useApplications(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.applications,
    queryFn: async () => {
      const res = await api.get("/applications");
      return res.data || [];
    },
    staleTime: 20 * 1000,
    enabled,
  });
}

// 6. Notifications Hook (staleTime: 10 sec, refetchInterval: 20 sec - pauses on tab hidden by default)
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.notifications,
    queryFn: async () => {
      const res = await api.get("/notifications");
      return res.data || [];
    },
    staleTime: 10 * 1000,
    refetchInterval: 20 * 1000,
    enabled,
  });
}

// 7. Announcements Hook (staleTime: 15 min)
export function useAnnouncements(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.announcements,
    queryFn: async () => {
      const res = await api.get("/announcements");
      return res.data || [];
    },
    staleTime: 15 * 60 * 1000,
    enabled,
  });
}

// 8. Calendar Events Hook (staleTime: 30 sec)
export function useCalendarEvents(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.calendar,
    queryFn: async () => {
      const res = await api.get("/calendar");
      return res.data || [];
    },
    staleTime: 30 * 1000,
    enabled,
  });
}

// 9. Resume Hook (staleTime: 5 min)
export function useResumeMe(enabled = true) {
  return useQuery({
    queryKey: CACHE_KEYS.resume,
    queryFn: async () => {
      const res = await api.get("/resumes/me");
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
