import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Create Account",
  description:
    "Create your free NEXTUP.AI account to start tracking campus placements, get shortlist alerts, and manage your placement journey at VIT Vellore.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
