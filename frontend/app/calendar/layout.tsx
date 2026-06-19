"use client";

import React, { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { isProfileComplete } from "@/lib/profile-utils";
import Sidebar from "@/components/Sidebar";

export default function CalendarLayout({
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
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <Suspense fallback={<div className="w-64 bg-background border-r-2 border-border hidden md:block" />}>
        <Sidebar />
      </Suspense>
      <main className="md:pl-64 flex flex-col min-h-screen w-full">
        {children}
      </main>
    </div>
  );
}
