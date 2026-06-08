"use client";

import React, { useEffect, useState, useRef } from "react";
import { Bell, Check, CheckCheck, AlertCircle } from "lucide-react";
import api from "@/lib/api";

interface Notification {
  id: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsDropdown() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const response = await api.get("/notifications");
      setNotifications(response.data);
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    }
  };

  useEffect(() => {
    fetchNotifications();
    // Poll for new notifications every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
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

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.post("/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
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
        <div className="absolute right-0 mt-3 w-80 sm:w-96 border-2 border-border bg-card shadow-2xl z-50 rounded-none animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-border px-4 py-3 bg-muted/50">
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
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <AlertCircle size={24} className="stroke-1" />
                <span className="text-xs font-bold uppercase tracking-wider">ALL CLEAR</span>
                <span className="text-[10px] uppercase">No new alerts at this time.</span>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex flex-col gap-1 p-4 transition-all duration-200 ${
                    notif.is_read ? "opacity-60 bg-transparent" : "bg-accent/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-medium text-foreground leading-relaxed">
                      {notif.message}
                    </p>
                    {!notif.is_read && (
                      <button
                        onClick={() => handleMarkAsRead(notif.id)}
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
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
