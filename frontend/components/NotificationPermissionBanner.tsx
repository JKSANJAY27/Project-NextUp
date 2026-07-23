"use client";

/**
 * NotificationPermissionBanner
 *
 * A subtle, dismissible banner shown once per session to users
 * who haven't yet granted or denied browser notification permission.
 *
 * - Only shows when permission === "default" (i.e., not yet decided).
 * - Disappears automatically once permission is granted or denied.
 * - Stores the dismissal in sessionStorage so it doesn't re-appear on navigation.
 */

import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { useNotifications } from "@/lib/notification-context";

const BANNER_DISMISSED_KEY = "nextup-notif-banner-dismissed";

export default function NotificationPermissionBanner() {
  const { notifPermission, requestPermission } = useNotifications();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't render on server
    if (typeof window === "undefined") return;

    // Banner conditions:
    // 1. Notifications are supported
    // 2. Permission is still "default" (user hasn't decided)
    // 3. User hasn't dismissed the banner this session
    const alreadyDismissed =
      sessionStorage.getItem(BANNER_DISMISSED_KEY) === "true";

    if (
      notifPermission === "default" &&
      "Notification" in window &&
      !alreadyDismissed
    ) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [notifPermission]);

  const handleDismiss = () => {
    sessionStorage.setItem(BANNER_DISMISSED_KEY, "true");
    setVisible(false);
  };

  const handleEnable = async () => {
    const result = await requestPermission();
    // Banner auto-hides via the useEffect above reacting to notifPermission change
    if (result !== "default") {
      handleDismiss();
    }
  };

  if (!visible) return null;

  return (
    <div
      className={`
        w-full flex items-center justify-between gap-4 px-6 py-2.5
        bg-accent/10 border-b-2 border-accent/30 backdrop-blur-sm
        text-foreground
        animate-in slide-in-from-top-1 duration-300
      `}
      role="banner"
      aria-label="Browser notification permission request"
    >
      {/* Left: Icon + message */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center h-7 w-7 bg-accent/20 border border-accent/40 rounded-none">
          <Bell size={13} className="text-accent" />
        </div>
        <p className="text-[11px] font-semibold tracking-wide truncate">
          <span className="text-accent font-black uppercase tracking-wider">
            ENABLE ALERTS —{" "}
          </span>
          Get instant desktop notifications when you&apos;re shortlisted.
        </p>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleEnable}
          className="
            flex items-center gap-1.5 px-3 py-1.5
            bg-accent text-black text-[10px] font-black uppercase tracking-widest
            hover:bg-accent/80 active:scale-95 transition-all duration-150
            border-2 border-transparent hover:border-accent/50
            whitespace-nowrap
          "
        >
          <Bell size={10} />
          Enable
        </button>
        <button
          onClick={handleDismiss}
          title="Dismiss"
          className="
            p-1.5 border border-border text-muted-foreground
            hover:bg-muted hover:text-foreground hover:border-foreground/30
            transition-colors duration-150 rounded-none active:scale-95
          "
          aria-label="Dismiss notification banner"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
