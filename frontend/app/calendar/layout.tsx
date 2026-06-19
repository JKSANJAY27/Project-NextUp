import React, { Suspense } from "react";
import Sidebar from "@/components/Sidebar";

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Suspense fallback={<div className="w-64 bg-background border-r-2 border-border hidden md:block" />}>
        <Sidebar />
      </Suspense>
      <main className="md:pl-64 flex flex-col min-h-screen w-full">
        {children}
      </main>
    </div>
  );
}
