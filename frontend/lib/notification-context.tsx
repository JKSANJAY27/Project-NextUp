"use client";

/**
 * NotificationContext
 *
 * Single source of truth for notification state across all authenticated pages.
 *
 * Responsibilities:
 *  - Owns ONE Supabase realtime channel (instead of each layout having its own).
 *  - Fires Web Notifications API toasts for brand-new unread notifications.
 *  - Updates the browser tab title with the unread count (WhatsApp-style).
 *  - Exposes `unreadCount`, `requestPermission`, and `refreshNotifications`
 *    via context so the NotificationsDropdown can stay in sync.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RawNotification {
  id: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationBundle {
  company_id: string;
  company_name: string;
  role: string;
  category: string;
  unread_count: number;
  notifications: RawNotification[];
}

interface NotificationContextValue {
  /** Total number of unread notifications across all bundles. */
  unreadCount: number;
  /** The latest fetched bundles (active scope). Consumed by NotificationsDropdown. */
  bundles: NotificationBundle[];
  /** Force a fresh fetch from the API. */
  refreshNotifications: () => Promise<void>;
  /** Request browser notification permission (call on user gesture). */
  requestPermission: () => Promise<NotificationPermission>;
  /** Current browser notification permission state. */
  notifPermission: NotificationPermission | "unsupported";
}

// ─── Context ─────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  bundles: [],
  refreshNotifications: async () => {},
  requestPermission: async () => "default",
  notifPermission: "default",
});

export function useNotifications() {
  return useContext(NotificationContext);
}

// ─── Original title cache ─────────────────────────────────────────────────────

const ORIGINAL_TITLE = "NEXTUP.AI — Placement Tracker for VIT Vellore Students";

function updateTabTitle(count: number) {
  if (typeof document === "undefined") return;
  document.title = count > 0 ? `(${count}) ${ORIGINAL_TITLE}` : ORIGINAL_TITLE;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [bundles, setBundles] = useState<NotificationBundle[]>([]);
  const [notifPermission, setNotifPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");

  // Track IDs we've already fired a push notification for to avoid duplicates
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  // Track whether this is the very first fetch (skip push toasts on initial load)
  const isFirstFetchRef = useRef(true);

  const unreadCount = bundles.reduce((acc, b) => acc + b.unread_count, 0);

  // ── Read current browser permission on mount ──────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotifPermission("unsupported");
      return;
    }
    setNotifPermission(Notification.permission);
  }, []);

  // ── Request browser permission (call on user gesture) ────────────────────
  const requestPermission =
    useCallback(async (): Promise<NotificationPermission> => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return "denied";
      }
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      return result;
    }, []);

  // ── Fire OS push notification for a single notification ──────────────────
  const fireOsNotification = useCallback(
    (notif: RawNotification, companyName: string, role: string) => {
      if (
        typeof window === "undefined" ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
      ) {
        return;
      }
      if (notifiedIdsRef.current.has(notif.id)) return;
      notifiedIdsRef.current.add(notif.id);

      const n = new Notification(`NEXTUP.AI — ${companyName}`, {
        body: notif.message,
        icon: "/icon.png",
        badge: "/icon.png",
        // Tag per company so multiple alerts from same company collapse
        tag: `nextup-${companyName}-${role}`,
        silent: false,
      } as NotificationOptions);

      n.onclick = () => {
        window.focus();
        n.close();
      };
    },
    []
  );

  // ── Fetch notifications from API ──────────────────────────────────────────
  const refreshNotifications = useCallback(async () => {
    try {
      const response = await api.get<NotificationBundle[]>(
        "/notifications?scope=all_active"
      );
      const fresh = response.data || [];

      setBundles(fresh);

      // Fire OS toasts for new unread notifications (not on initial load)
      if (!isFirstFetchRef.current) {
        for (const bundle of fresh) {
          for (const notif of bundle.notifications) {
            if (!notif.is_read) {
              fireOsNotification(notif, bundle.company_name, bundle.role);
            }
          }
        }
      } else {
        // On first fetch, seed the notified set so we don't toast stale items
        for (const bundle of fresh) {
          for (const notif of bundle.notifications) {
            notifiedIdsRef.current.add(notif.id);
          }
        }
        isFirstFetchRef.current = false;
      }
    } catch (error) {
      console.error("[NotificationContext] Failed to fetch notifications:", error);
    }
  }, [fireOsNotification]);

  // ── Update tab title whenever unread count changes ────────────────────────
  useEffect(() => {
    updateTabTitle(unreadCount);
    // Restore original title on unmount
    return () => {
      updateTabTitle(0);
    };
  }, [unreadCount]);

  // ── Initial fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  // ── Supabase realtime subscription (single, shared channel) ──────────────
  useEffect(() => {
    const channel = supabase
      .channel("realtime-notifications-global")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          refreshNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshNotifications]);

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        bundles,
        refreshNotifications,
        requestPermission,
        notifPermission,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
