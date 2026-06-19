import React, { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import NotificationsDropdown from "@/components/NotificationsDropdown";

export default function ResumeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <Suspense fallback={<div className="w-64 bg-background border-r-2 border-border hidden md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="flex-1 md:pl-64 flex flex-col min-h-screen w-full">
        <header className="flex h-16 w-full items-center justify-between border-b-2 border-border bg-card/50 backdrop-blur-md px-8 sticky top-0 z-30">
          <div className="flex items-center gap-4">
            <h1 className="text-xs font-black tracking-widest text-muted-foreground uppercase font-mono">
              SYSTEM // RESUME
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <NotificationsDropdown />
          </div>
        </header>
        <main className="flex-1 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}
