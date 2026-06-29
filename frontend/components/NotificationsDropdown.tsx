"use client";

import React, { useEffect, useState, useRef } from "react";
import { Bell, Check, CheckCheck, AlertCircle, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface Notification {
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
  notifications: Notification[];
}

export default function NotificationsDropdown() {
  const [bundles, setBundles] = useState<NotificationBundle[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const response = await api.get<NotificationBundle[]>("/notifications?scope=all_active");
      setBundles(response.data || []);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    }
  };

  useEffect(() => {
    fetchNotifications();

    // Subscribe to realtime database changes for notifications
    const channel = supabase
      .channel("realtime-notifications-dropdown")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = bundles.reduce((acc, b) => acc + b.unread_count, 0);

  const handleMarkAsRead = async (id: string, companyId: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);

      setBundles((prev) =>
        prev.map((b) => {
          if (b.company_id === companyId) {
            return {
              ...b,
              unread_count: Math.max(0, b.unread_count - 1),
              notifications: b.notifications.map((n) =>
                n.id === id ? { ...n, is_read: true } : n
              ),
            };
          }
          return b;
        })
      );
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleMarkCompanyRead = async (companyId: string) => {
    try {
      await api.post(`/notifications/company/${companyId}/read`);

      setBundles((prev) =>
        prev.map((b) => {
          if (b.company_id === companyId) {
            return {
              ...b,
              unread_count: 0,
              notifications: b.notifications.map((n) => ({ ...n, is_read: true })),
            };
          }
          return b;
        })
      );
    } catch (error) {
      console.error("Failed to mark company as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.post("/notifications/read-all");

      setBundles((prev) =>
        prev.map((b) => ({
          ...b,
          unread_count: 0,
          notifications: b.notifications.map((n) => ({ ...n, is_read: true })),
        }))
      );
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center justify-center border-2 border-border bg-card p-2 text-foreground hover:bg-accent hover:text-black transition-all active:scale-95 duration-200"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center bg-accent text-[10px] font-extrabold text-black ring-2 ring-background rounded-none">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Card */}
      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 sm:w-96 border-2 border-border bg-card shadow-2xl z-50 rounded-none animate-in fade-in slide-in-from-top-2 duration-200 max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-border px-4 py-3 bg-muted/50 shrink-0">
            <span className="text-xs font-bold tracking-wider text-foreground uppercase">
              NOTIFICATIONS ({unreadCount} UNREAD)
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                className="flex items-center gap-1 text-[10px] font-bold text-accent hover:underline uppercase"
              >
                <CheckCheck size={12} />
                <span>MARK ALL READ</span>
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto divide-y divide-border">
            {bundles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <AlertCircle size={24} className="stroke-1" />
                <span className="text-xs font-bold uppercase tracking-wider">ALL CLEAR</span>
                <span className="text-[10px] uppercase">No new alerts at this time.</span>
              </div>
            ) : (
              bundles.map((bundle) => (
                <div key={bundle.company_id} className="flex flex-col bg-card">
                  {/* Bundle Header */}
                  <div className="flex items-center justify-between px-3 py-2 bg-accent/10 border-b border-border sticky top-0 z-10">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-bold text-foreground uppercase flex items-center gap-1.5">
                        <Building2 size={12} className="text-accent" />
                        {bundle.company_name}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {bundle.role}
                      </span>
                    </div>
                    {bundle.unread_count > 0 && (
                      <button
                        onClick={() => handleMarkCompanyRead(bundle.company_id)}
                        className="text-[9px] font-bold text-accent hover:underline uppercase flex items-center gap-1"
                      >
                        <Check size={10} />
                        CLEAR
                      </button>
                    )}
                  </div>

                  {/* Bundle Notifications */}
                  <div className="flex flex-col divide-y divide-border/50">
                    {bundle.notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`flex flex-col gap-1 p-3 transition-all duration-200 ${
                          notif.is_read ? "opacity-60 bg-transparent" : "bg-accent/5"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs font-medium text-foreground leading-relaxed">
                            {notif.message}
                          </p>
                          {!notif.is_read && (
                            <button
                              onClick={() => handleMarkAsRead(notif.id, bundle.company_id)}
                              className="flex-shrink-0 mt-0.5 border border-border p-1 bg-card hover:bg-accent hover:text-black transition-colors rounded-none"
                              title="Mark as read"
                            >
                              <Check size={10} />
                            </button>
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground font-mono">
                          {new Date(notif.created_at).toLocaleString("en-IN", {
                            hour: "numeric",
                            minute: "numeric",
                            day: "2-digit",
                            month: "short",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
