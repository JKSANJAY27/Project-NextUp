import React from "react";
import Sidebar from "@/components/Sidebar";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="md:pl-64 flex flex-col min-h-screen w-full">
        {children}
      </main>
    </div>
  );
}
