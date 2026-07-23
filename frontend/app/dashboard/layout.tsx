"use client";

import React, { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { isProfileComplete } from "@/lib/profile-utils";
import Sidebar from "@/components/Sidebar";
import NotificationsDropdown from "@/components/NotificationsDropdown";
import NotificationPermissionBanner from "@/components/NotificationPermissionBanner";
import VaultGate from "@/components/VaultGate";
import { NotificationProvider } from "@/lib/notification-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, token } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    if (user && !isProfileComplete(user)) {
      router.push("/profile");
    }
  }, [user, token, router]);

  if (!token || (user && !isProfileComplete(user))) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-bold tracking-widest uppercase font-mono">
        <div className="text-center space-y-4">
          <div className="h-2.5 w-24 bg-accent mx-auto animate-pulse" />
          <p className="text-xs">REDIRECTING TO PROFILE SETUP...</p>
        </div>
      </div>
    );
  }

  return (
    <NotificationProvider>
    <VaultGate>
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <Suspense fallback={<div className="w-64 bg-background border-r-2 border-border hidden md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen w-full">
        {/* Sticky top navigation bar */}
        <header className="flex h-16 w-full items-center justify-between border-b-2 border-border bg-card/50 backdrop-blur-md px-8 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <h1 className="text-xs font-black tracking-widest text-muted-foreground uppercase font-mono">
              SYSTEM // ACTIVE
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <NotificationsDropdown />
          </div>
        </header>
        {/* Permission banner — shown beneath header when permission is "default" */}
        <NotificationPermissionBanner />
        <main className="flex-1 w-full">
          {children}
        </main>
      </div>
    </div>
    </VaultGate>
    </NotificationProvider>
  );
}
