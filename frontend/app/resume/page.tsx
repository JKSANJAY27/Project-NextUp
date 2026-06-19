"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ResumePageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/profile");
  }, [router]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-sans">
      <div className="text-center space-y-4">
        <Loader2 className="animate-spin text-accent h-12 w-12 mx-auto" />
        <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
          Redirecting to Profile Setup...
        </p>
      </div>
    </div>
  );
}
