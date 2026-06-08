"use client";

import React from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { ShieldCheck, ArrowRight, Zap, RefreshCw, Key } from "lucide-react";

export default function LandingPage() {
  const { token } = useAppStore();

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      
      {/* Navigation Top Bar */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 md:px-16 w-full bg-background z-10">
        <span className="text-xl font-extrabold tracking-tighter uppercase text-foreground leading-none">
          NEXTUP<span className="text-accent">.AI</span>
        </span>
        <nav className="flex items-center gap-6">
          <Link href="/login" className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors">
            LOGIN
          </Link>
          <Link 
            href={token ? "/dashboard" : "/register"}
            className="flex items-center justify-center border-2 border-border bg-foreground text-background px-6 h-10 text-xs font-bold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
          >
            {token ? "DASHBOARD" : "REGISTER"}
          </Link>
        </nav>
      </header>

      {/* Infinite scrolling marquee header */}
      <div className="border-b-2 border-border bg-accent py-4 overflow-hidden select-none">
        <div className="flex w-max animate-marquee">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-16 text-black font-extrabold text-2xl tracking-tighter uppercase shrink-0 pr-16">
              <span>ZERO KNOWLEDGE ARCHITECTURE</span>
              <span>✦</span>
              <span>VIT CDC AUTOMATION</span>
              <span>✦</span>
              <span>LOCAL AES-256 DECRYPTION</span>
              <span>✦</span>
              <span>INTELLIGENT ELIGIBILITY CHECKER</span>
              <span>✦</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center text-center py-24 px-8 border-b-2 border-border max-w-[95vw] mx-auto w-full">
        <div className="space-y-6 max-w-4xl">
          <div className="inline-flex items-center gap-2 border-2 border-border bg-muted/30 px-4 py-2 text-xs font-extrabold tracking-widest text-accent uppercase">
            <ShieldCheck size={14} />
            <span>🔒 ZERO-KNOWLEDGE PLACEMENT OS</span>
          </div>
          
          <h1 className="text-[clamp(2.5rem,10vw,8rem)] font-extrabold tracking-tighter uppercase leading-[0.8] text-foreground">
            AUTOMATE
            <br />
            YOUR PLACEMENTS
          </h1>
          
          <p className="text-lg md:text-xl font-medium text-muted-foreground max-w-2xl mx-auto uppercase tracking-wide leading-relaxed">
            Centralize your CDC emails, track shortlist Excel sheets, analyze JD keywords, and tailor resumes—all with zero-knowledge encryption keys held only by you.
          </p>
          
          <div className="pt-8 flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href={token ? "/dashboard" : "/register"}
              className="flex items-center justify-center gap-3 h-16 px-10 border-2 border-border bg-foreground text-background text-sm font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all"
            >
              <span>{token ? "ENTER SYSTEM" : "SECURE PLACEMENT ACCESS"}</span>
              <ArrowRight size={16} />
            </Link>
            <Link
              href="#security"
              className="flex items-center justify-center h-16 px-10 border-2 border-border bg-transparent text-foreground text-sm font-extrabold tracking-widest uppercase hover:bg-muted transition-all active:scale-95"
            >
              PRIVACY DEEP DIVE
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 border-b-2 border-border max-w-[95vw] mx-auto w-full">
        <div className="border-b-2 md:border-b-0 md:border-r-2 border-border p-12 space-y-6 hover:bg-muted/10 transition-colors">
          <div className="h-12 w-12 bg-accent text-black flex items-center justify-center border-2 border-black">
            <Zap size={20} />
          </div>
          <h3 className="text-2xl font-bold uppercase tracking-tighter">ELIGIBILITY FILTER</h3>
          <p className="text-sm text-muted-foreground uppercase tracking-tight leading-snug">
            Compare college placement requirements (CGPA, Branch, Arrears) automatically. Calculations run on your device or in-memory, without sharing your raw metrics.
          </p>
        </div>
        <div className="border-b-2 md:border-b-0 md:border-r-2 border-border p-12 space-y-6 hover:bg-muted/10 transition-colors">
          <div className="h-12 w-12 bg-accent text-black flex items-center justify-center border-2 border-black">
            <RefreshCw size={20} />
          </div>
          <h3 className="text-2xl font-bold uppercase tracking-tighter">GMAIL SYNC ENGINE</h3>
          <p className="text-sm text-muted-foreground uppercase tracking-tight leading-snug">
            Poll CDC emails and parse shortlist Excels automatically. When a file arrives, the client compares your Neo ID locally, giving you shortlist notifications instantly.
          </p>
        </div>
        <div className="p-12 space-y-6 hover:bg-muted/10 transition-colors">
          <div className="h-12 w-12 bg-accent text-black flex items-center justify-center border-2 border-black">
            <Key size={20} />
          </div>
          <h3 className="text-2xl font-bold uppercase tracking-tighter">LOCAL ENCRYPTION</h3>
          <p className="text-sm text-muted-foreground uppercase tracking-tight leading-snug">
            PBKDF2 key derivation from your password creates a 256-bit AES key. This key encrypts your Neo ID and CGPA locally, so the server only receives random hex blobs.
          </p>
        </div>
      </section>

      {/* Security Architecture Page */}
      <section id="security" className="py-24 px-8 max-w-4xl mx-auto space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 border border-border bg-muted/30 px-3 py-1 text-[10px] font-extrabold tracking-widest text-accent uppercase">
            <span>🛡️ SECURITY SPECIFICATION</span>
          </div>
          <h2 className="text-4xl font-extrabold tracking-tighter uppercase">
            PRIVACY-FIRST ZERO KNOWLEDGE DESIGN
          </h2>
        </div>

        <div className="border-2 border-border p-8 md:p-12 bg-muted/5 space-y-8 uppercase text-xs tracking-wider leading-relaxed">
          <div className="space-y-2">
            <h4 className="font-extrabold text-foreground text-sm text-accent">1. PBKDF2 KEY DERIVATION</h4>
            <p className="text-muted-foreground">
              When registering, the database stores a secure random salt. On each login, the client inputs their password, which is mixed with this salt in the browser via PBKDF2-HMAC-SHA256 (100,000 iterations) to derive a 256-bit AES key.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-extrabold text-foreground text-sm text-accent">2. IN-BROWSER ENCRYPTION</h4>
            <p className="text-muted-foreground">
              Sensitive details (Neo ID, CGPA, grades, application status, notes, and Gmail access tokens) are encrypted locally using AES-GCM-256 before transit. The server stores only ciphertext.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-extrabold text-foreground text-sm text-accent">3. IN-MEMORY DECRYPTION ONLY</h4>
            <p className="text-muted-foreground">
              When processing tasks like checking shortlist Excels or syncing emails, the client temporarily passes the AES key in the X-Client-Key request header. The server decrypts in-memory for the duration of the request and immediately discards it.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-extrabold text-foreground text-sm text-accent">4. SECURE MEMORY WIPING</h4>
            <p className="text-muted-foreground">
              Logging out deletes the AES key from memory. It is never stored in localStorage, indexDB, or cookies. It exists only for your session.
            </p>
          </div>
        </div>
      </section>

      {/* Symmetrical footer */}
      <footer className="border-t-2 border-border py-12 px-8 text-center bg-muted/10 mt-auto w-full">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          © {new Date().getFullYear()} NEXTUP.AI ✦ DESIGNED FOR VIT VELLORE ✦ END-TO-END ENCRYPTED
        </p>
      </footer>

    </main>
  );
}
