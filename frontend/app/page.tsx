"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import {
  ArrowRight,
  Bell,
  CheckCircle,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Filter,
  GitBranch,
  Globe,
  Lock,
  Mail,
  Shield,
  Sparkles,
  Calendar,
  Terminal,
  Zap,
  GitMerge,
  Search,
  Database,
  BrainCircuit,
  FileText,
  Users,
  BellRing,
  AlertTriangle,
  Sun,
  Moon,
} from "lucide-react";
import Tooltip from "@/components/Tooltip";
import Logo from "@/components/Logo";
import dynamic from "next/dynamic";

const HeroScene = dynamic(() => import("@/components/hero/HeroScene"), { ssr: false });



// ─── FAQ Data ─────────────────────────────────────────────────────────────────
const faqs = [
  {
    q: "What exactly does NEXTUP.AI do?",
    a: "NEXTUP.AI is a smart placement tracker for VIT Vellore students. It processes shared CDC updates from a developer-managed inbox, detects shortlist matches, checks eligibility for upcoming drives, and keeps applications organised in one place — so you never miss an opportunity.",
  },
  {
    q: "Is NEXTUP.AI free to use?",
    a: "Yes, completely free. NEXTUP.AI is built and maintained by VIT students for VIT students. There are no subscription fees, hidden charges, or premium tiers.",
  },
  {
    q: "How does the automatic shortlist detection work?",
    a: "We monitor shared placement updates from a developer-managed college inbox. When a shortlist sheet arrives, the platform processes it once and checks for matches using protected profile data. We never connect to, read, or synchronise your personal Gmail inbox.",
  },
  {
    q: "Is my personal data safe?",
    a: "Your Neo ID, CGPA, and marks are protected before storage. Your Neo ID is not stored as plain text: we keep an encrypted value plus a one-way matching token so the system can check shortlist sheets without exposing the original ID in normal database records.",
  },
  {
    q: "What happens if I change my password?",
    a: "Your encryption key is derived from your password. If you change it, you'll need to re-enter your registration number, CGPA, and marks — because the old encrypted data can't be read with the new key. The app warns you clearly before any password change.",
  },
  {
    q: "What is the AI Resume Tailoring feature?",
    a: "The AI Resume Tailoring feature rewrites your resume to match a specific job description — targeting the right keywords, reordering your projects by relevance, and ensuring no metric you didn't write gets invented. The AI runs on our self-hosted Hugging Face server (not in your browser). Your resume content is processed securely and the generated output is encrypted before storage — but it does travel to our inference server to be processed.",
  },
  {
    q: "Does it work for students from all VIT branches and programmes?",
    a: "NEXTUP.AI is powered by a CSE student's college Gmail inbox. This means it parses and displays all placement emails that arrive in that inbox — including drives for Mechanical, ECE, EEE, M.Tech, MBA, and other departments, whenever those mails are also sent to CSE students. However, we cannot guarantee coverage of drives whose emails are sent exclusively to other departments and never reach a CSE inbox. Eligibility checks work for all branches and degree types once you enter your profile.",
  },
  {
    q: "Can I use NEXTUP.AI on my phone?",
    a: "Yes, NEXTUP.AI is fully responsive and works on mobile browsers. The dashboard, application tracker, and calendar all work on smaller screens.",
  },
  {
    q: "Is NEXTUP.AI an official VIT or CDC product?",
    a: "No. NEXTUP.AI is a student-built project and is not affiliated with, endorsed by, or officially connected to VIT Vellore or the Career Development Centre (CDC). Always verify placement information with the official VIT CDC portal.",
  },
];

// ─── FAQ Item ────────────────────────────────────────────────────────────────
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start justify-between gap-4 py-5 text-left hover:text-accent transition-colors group"
        aria-expanded={open}
      >
        <span className="text-sm font-bold tracking-tight">{q}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 mt-0.5 transition-transform duration-200 text-muted-foreground group-hover:text-accent ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          open ? "max-h-96 pb-5" : "max-h-0"
        }`}
      >
        <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
      </div>
    </div>
  );
}

// ─── Builders Data ───────────────────────────────────────────────────────────
// Photos: drop the two headshots at frontend/public/images/peeps/ with these
// exact filenames — the card falls back to an initials block until they exist.
// Fill in the missing profile URLs below; empty links are simply not rendered.
const builders = [
  {
    id: "BLDR_01",
    name: "SANJAY",
    surname: "J K",
    initials: "JK",
    role: "Software Systems Builder",
    photo: "/images/peeps/sanjay.jfif",
    bio: "I enjoy building software where system design matters as much as the AI itself. My work focuses on backend architecture, full-stack applications, and making AI reliable enough to become part of production software.",
    whoami: "thinks in systems,\nbuilds in software.",
    stats: [
      { k: "Published Patents", v: "2" },
      { k: "GATE CSE AIR", v: "1603" },
      { k: "Research Scholar", v: "UKIERI" },
    ],
    expertise: ["Backend Systems", "LLM Applications", "System Design", "Real-Time Software"],
    links: [
      { label: "GitHub", href: "https://github.com/JKSANJAY27", icon: GitBranch },
      { label: "LinkedIn", href: "https://linkedin.com/in/sanjay-j-k/", icon: ExternalLink },
      { label: "Email", href: "mailto:j.k.sanjay2006@gmail.com", icon: Mail },
      { label: "Portfolio", href: "https://j-k-sanjay.onrender.com/", icon: Globe },
    ],
    tilt: "md:rotate-1",
  },
  {
    id: "BLDR_02",
    name: "HARIPRASAD",
    surname: "T",
    initials: "HP",
    role: "Full-Stack Developer",
    photo: "/images/peeps/hariprasad.jfif",
    bio: "I usually start by understanding how people already solve a problem before thinking about the technology. I enjoy mapping real-world workflows into software that feels intuitive, like municipal operations in JanVedha or the placement journey in NextUpAI.",
    whoami: "designs flow\nbefore features.",
    stats: [
      { k: "SANKALP Grand Finalist", v: "Top 10" },
      { k: "Award", v: "Judges\u2019 Choice" },
      { k: "2025\u201326", v: "VIT Achiever" },
    ],
    expertise: ["Full-Stack Development", "Product Design", "Workflow Design", "AI Integration"],
    links: [
      { label: "GitHub", href: "https://github.com/HARIPRASAD-04", icon: GitBranch },
      { label: "LinkedIn", href: "https://www.linkedin.com/in/hariprasad-t-91799b28a/", icon: ExternalLink },
      { label: "Email", href: "mailto:hariprasad.t2023@vitstudent.ac.in", icon: Mail },
    ],
    tilt: "md:-rotate-1",
  },
];

// ─── Builder Photo (with initials fallback until photos are added) ───────────
function BuilderPhoto({ src, alt, initials }: { src: string; alt: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(223,225,4,0.06)_10px,rgba(223,225,4,0.06)_20px)]">
        <span className="text-6xl font-extrabold tracking-tighter text-accent/40">{initials}</span>
        <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">photo loading…</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- needs onError fallback until the photos are committed
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover object-top grayscale group-hover:grayscale-0 transition-all duration-500 group-hover:scale-[1.03]"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Builder Card ────────────────────────────────────────────────────────────
function BuilderCard({ b }: { b: (typeof builders)[number] }) {
  const liveLinks = b.links.filter((l) => l.href);
  return (
    <article
      className={`relative border-2 border-border bg-card group transition-all duration-300 ${b.tilt} md:hover:rotate-0 hover:border-accent hover:shadow-[10px_10px_0px_0px_#DFE104]`}
    >
      {/* HUD corner brackets */}
      <span aria-hidden className="absolute -top-[2px] -left-[2px] w-6 h-6 border-t-4 border-l-4 border-accent" />
      <span aria-hidden className="absolute -top-[2px] -right-[2px] w-6 h-6 border-t-4 border-r-4 border-accent" />
      <span aria-hidden className="absolute -bottom-[2px] -left-[2px] w-6 h-6 border-b-4 border-l-4 border-accent" />
      <span aria-hidden className="absolute -bottom-[2px] -right-[2px] w-6 h-6 border-b-4 border-r-4 border-accent" />

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,42%)_1fr]">
        {/* Photo panel */}
        <div className="relative aspect-[4/5] sm:aspect-auto sm:min-h-full border-b-2 sm:border-b-0 sm:border-r-2 border-border overflow-hidden bg-muted/20">
          <BuilderPhoto src={b.photo} alt={`${b.name} ${b.surname} — ${b.role}`} initials={b.initials} />
          {/* scanline overlay */}
          <div aria-hidden className="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.18)_0px,rgba(0,0,0,0.18)_1px,transparent_1px,transparent_4px)] opacity-40" />
          {/* ID tag */}
          <div className="absolute bottom-0 left-0 bg-black/85 border-t-2 border-r-2 border-accent px-3 py-1.5">
            <span className="font-mono text-[10px] font-bold tracking-widest text-accent">
              {`${b.id} // VIT_VELLORE`}
            </span>
          </div>
        </div>

        {/* Info panel */}
        <div className="p-5 md:p-6 flex flex-col gap-4">
          <div className="space-y-2">
            <h3 className="text-2xl md:text-3xl font-extrabold tracking-tighter uppercase leading-none">
              {b.name} <span className="text-accent">{b.surname}</span>
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-2 bg-accent text-black px-3 py-1.5 text-[11px] font-extrabold tracking-widest uppercase">
                <Terminal size={12} />
                {b.role}
              </span>
            </div>
          </div>

          <p className="text-[13px] text-muted-foreground leading-relaxed">{b.bio}</p>

          {/* whoami terminal strip */}
          <div className="border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed">
            <span className="text-accent">&gt; whoami</span>
            <br />
            <span className="text-muted-foreground whitespace-pre-line">{b.whoami}</span>
            <span className="inline-block w-2 h-3 bg-accent ml-1 animate-pulse align-middle" aria-hidden />
          </div>

          {/* stat tiles */}
          <div className="grid grid-cols-3 border-2 border-border divide-x-2 divide-border">
            {b.stats.map((s) => (
              <div key={s.k} className="p-2.5 text-center hover:bg-accent hover:text-black transition-colors group/stat">
                <div className="text-base md:text-lg font-extrabold tracking-tighter">{s.v}</div>
                <div className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground group-hover/stat:text-black">
                  {s.k}
                </div>
              </div>
            ))}
          </div>

          {/* expertise chips */}
          <div>
            <p className="text-[10px] font-extrabold tracking-widest text-accent uppercase mb-2">Expertise</p>
            <div className="flex flex-wrap gap-1.5">
              {b.expertise.map((e) => (
                <span
                  key={e}
                  className="border border-border px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase text-muted-foreground hover:border-accent hover:text-accent transition-colors cursor-default"
                >
                  {e}
                </span>
              ))}
            </div>
          </div>

          {/* links */}
          {liveLinks.length > 0 && (
            <div className="flex items-center gap-0 border-2 border-border divide-x-2 divide-border mt-auto">
              {liveLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target={l.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  aria-label={l.label}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 text-[10px] font-bold tracking-wider uppercase text-muted-foreground hover:bg-accent hover:text-black transition-colors"
                >
                  <l.icon size={13} />
                  <span>{l.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// ─── Feature Card (unused standalone, features rendered inline) ──────────────
// kept for reference; see features grid section below


// ─── Main Page ───────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { token } = useAppStore();
  const [isDark, setIsDark] = useState(true);

  // Initialise from saved pref or system pref
  useEffect(() => {
    const saved = localStorage.getItem("landing-theme");
    if (saved) {
      const dark = saved === "dark";
      setIsDark(dark);
      document.documentElement.classList.toggle("dark", dark);
    } else {
      // default dark
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("landing-theme", next ? "dark" : "light");
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col font-sans">

      {/* Navigation */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 md:px-16 w-full bg-background z-50 sticky top-0">
        <Link href="/" aria-label="NEXTUP.AI home" className="flex items-center">
          <Logo size="md" />
        </Link>
        <nav className="flex items-center gap-6" aria-label="Primary navigation">
          <Link
            href="#features"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors hidden md:block"
          >
            Features
          </Link>
          <Link
            href="#how-it-works"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors hidden md:block"
          >
            How It Works
          </Link>
          <Link
            href="#builders"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors hidden md:block"
          >
            Builders
          </Link>
          <Link
            href="#faq"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors hidden md:block"
          >
            FAQ
          </Link>
          <Link
            href="/login"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors"
          >
            Sign In
          </Link>
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center w-10 h-10 border-2 border-border hover:border-accent hover:text-accent transition-all active:scale-95"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link
            href={token ? "/dashboard" : "/register"}
            className="flex items-center justify-center border-2 border-border bg-foreground text-background px-6 h-10 text-xs font-bold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
          >
            {token ? "Dashboard" : "Get Started Free"}
          </Link>
        </nav>
      </header>

      {/* Marquee — benefit-focused, no jargon */}
      <div className="hidden" aria-hidden="true">
        <div className="flex w-max animate-marquee">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-16 text-black font-extrabold text-2xl tracking-tighter uppercase shrink-0 pr-16">
              <span>Never Miss a Shortlist</span>
              <span>✦</span>
              <span>Track All Your Applications</span>
              <span>✦</span>
              <span>Smart JD Keyword Matching</span>
              <span>✦</span>
              <span>Automatic Email Parsing</span>
              <span>✦</span>
              <span>Private &amp; Secure by Design</span>
              <span>✦</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hero Section — pixel art scene with left-aligned text overlay */}
      <section
        className="relative w-full overflow-hidden border-b-2 border-border"
        style={{ height: "calc(100svh - 80px)", minHeight: "500px" }}
        aria-labelledby="hero-heading"
      >
        {/* Animated pixel-art background scene */}
        <HeroScene />

        {/* Text overlay — left-aligned, z above scene */}
        <div
          className="relative z-10 flex flex-col justify-center px-8 md:px-14 lg:px-20 py-12"
          style={{ height: "calc(100svh - 80px)", minHeight: "500px", maxWidth: "620px" }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 border-2 border-white/30 bg-black/40 px-4 py-2 text-xs font-extrabold tracking-widest text-accent uppercase mb-6 w-fit backdrop-blur-sm">
            <Bell size={14} />
            <span>NextUp — Free VIT Placement Tracker</span>
          </div>

          {/* Heading — Press Start 2P pixel font */}
          <h1
            id="hero-heading"
            className="hero-pixel-heading uppercase mb-6"
          >
            <span className="text-white">Never<br />Miss a<br /></span>
            <span className="text-accent">Shortlist</span>
          </h1>

          {/* Description */}
          <p className="text-sm md:text-base font-medium text-white/80 max-w-md leading-relaxed mb-3">
            NextUp automatically reads your CDC emails, detects shortlists,
            checks eligibility, and keeps all your applications organised —
            so you can focus on preparing, not tracking.
          </p>

          {/* SEO anchor */}
          <p className="text-[11px] text-white/50 max-w-sm font-mono tracking-wide mb-8" aria-hidden="false">
            NextUp VIT · Placement Tracker for VIT Vellore · VIT CDC shortlist detector · Free for all VIT students
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href={token ? "/dashboard" : "/register"}
              className="flex items-center justify-center gap-3 h-14 px-8 border-2 border-accent bg-accent text-black text-sm font-extrabold tracking-widest uppercase hover:bg-white hover:border-white hover:text-black active:scale-95 transition-all w-fit"
              aria-label={token ? "Go to dashboard" : "Register for free"}
            >
              <span>{token ? "Go to Dashboard" : "Get Started — It's Free"}</span>
              <ArrowRight size={16} />
            </Link>
            <Link
              href="#how-it-works"
              className="flex items-center justify-center h-14 px-8 border-2 border-white/60 bg-black/40 text-white text-sm font-extrabold tracking-widest uppercase hover:border-white hover:bg-white/10 transition-all active:scale-95 w-fit backdrop-blur-sm"
            >
              See How It Works
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section
        id="features"
        className="py-16 px-8 max-w-[95vw] mx-auto w-full border-b-2 border-border"
        aria-labelledby="features-heading"
      >
        <div className="text-center mb-12 space-y-3">
          <p className="text-xs font-extrabold tracking-widest text-accent uppercase">What you get</p>
          <h2 id="features-heading" className="text-3xl md:text-4xl font-extrabold tracking-tighter uppercase">
            Everything You Need for Placements
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            One platform to manage your entire campus placement journey — from the first CDC email to the final offer.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-2 border-border">
          {[
            {
              icon: <Bell size={20} />,
              title: "Instant Shortlist Alerts",
              description:
                "Get notified the moment a CDC shortlist email arrives and your name is found. No more manually checking spreadsheets or refreshing your inbox.",
              tooltip: "Automatically scans incoming CDC emails and cross-checks your registration number against shortlist Excel sheets in seconds.",
            },
            {
              icon: <Filter size={20} />,
              title: "Eligibility Checker",
              description:
                "See at a glance whether you're eligible for each drive — based on your CGPA, branch, arrears, and other criteria set by the company.",
              tooltip: "Compares the company's eligibility rules with your profile. Marks drives as Eligible, Ineligible, or Needs Verification.",
            },
            {
              icon: <ClipboardList size={20} />,
              title: "Application Tracker",
              description:
                "Track every application across stages: Applied → Shortlisted → Test → Interview → Offer. See your full placement history at a glance.",
              tooltip: "A Kanban-style tracker for every company you've applied to, with status updates, notes, and timeline views.",
            },
            {
              icon: <Mail size={20} />,
              title: "Automatic Email Parsing",
              description:
                "Connect your college Gmail once. NEXTUP.AI reads CDC placement emails, extracts company details, deadlines, and test dates automatically.",
              tooltip: "Uses your Gmail OAuth to read only CDC-tagged emails. No personal emails are accessed or stored.",
            },
            {
              icon: <Calendar size={20} />,
              title: "Placement Calendar",
              description:
                "All your upcoming tests, interviews, and deadlines in one visual calendar. Never double-book or forget a registration cutoff again.",
              tooltip: "Auto-populated from parsed CDC emails. You can also add manual events and set reminders.",
            },
            {
              icon: <Sparkles size={20} />,
              title: "AI Resume Tailoring",
              description:
                "Get a per-drive rewritten resume tailored to the actual job description. The AI highlights keyword gaps, rewrites project bullets for relevance, and scores ATS coverage — all verified so no invented metrics slip through.",
              tooltip: "Powered by a self-hosted Qwen2.5-3B model on our Hugging Face Space. Evidence-grounding gates ensure every metric in the output existed in your original resume.",
            },
            {
              icon: <Lock size={20} />,
              title: "Zero-Knowledge Encryption",
              description:
                "Your CGPA, marks, and registration number are encrypted right in your browser using AES-256-GCM before anything leaves your device. Our servers store only ciphertext they cannot decrypt.",
              tooltip: "Your encryption key is derived from your password via PBKDF2 and lives only in memory. A database breach yields nothing readable — we literally cannot decrypt your data.",
            },
            {
              icon: <Search size={20} />,
              title: "Blind-Index Shortlist Matching",
              description:
                "Shortlist Excel sheets and inline ID tables are matched against your registration number using a cryptographic hash — the server finds your name without ever seeing your actual ID.",
              tooltip: "A peppered HMAC of your registration number is stored server-side. Incoming shortlists are hashed the same way and intersected — plaintext IDs never exist on our servers.",
            },
            {
              icon: <GitMerge size={20} />,
              title: "Application Stage Machine",
              description:
                "Your application status advances automatically: Applied → OA → Interview → Offer, driven by what each shortlist is actually for — with guards against roster mails and re-sent lists.",
              tooltip: "Each list's purpose (OA schedule, interview shortlist, offer list, roster) drives the target stage. Re-sent duplicate lists are fingerprinted and ignored. Stages only move forward.",
            },
            {
              icon: <Zap size={20} />,
              title: "Resilient AI Gateway",
              description:
                "Email parsing and resume generation run through a multi-tier AI gateway with per-provider circuit breakers, so a slow or down HuggingFace Space never breaks core features.",
              tooltip: "Tier 1: own HF Space (qwen2.5:3b). Tier 2: HF Router (Llama-3.3-70B fallback). If all providers are down, deterministic fallbacks keep parsing and resume tailoring functional.",
            },
          ].map((feature, i) => (
            <div
              key={i}
              className={`border-border p-8 space-y-4 hover:bg-muted/10 hover:border-accent/30 transition-all group
                ${i % 2 === 0 ? "md:border-r-2" : ""}
                ${i < 8 ? "border-b-2" : ""}
              `}
            >
              <div className="flex items-start justify-between">
                <div className="h-12 w-12 bg-accent text-black flex items-center justify-center border-2 border-black shrink-0">
                  {feature.icon}
                </div>
                <Tooltip content={feature.tooltip} position="top">
                  <span
                    className="text-xs font-bold border border-border rounded-full px-1.5 py-0.5 text-muted-foreground hover:text-accent hover:border-accent cursor-help transition-colors opacity-0 group-hover:opacity-100"
                    aria-label={`More info about ${feature.title}`}
                  >
                    ?
                  </span>
                </Tooltip>
              </div>
              <h3 className="text-xl font-bold uppercase tracking-tighter">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="border-b-2 border-border bg-accent px-6 py-5 text-black" aria-label="Product benefits">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-center text-xs font-extrabold tracking-wider uppercase md:text-sm">
          <span>Private &amp; secure by design</span><span aria-hidden>✦</span><span>Never miss a shortlist</span><span aria-hidden>✦</span><span>Track every application</span>
        </div>
      </div>

      {/* How It Works / System Architecture */}
      <section
        id="how-it-works"
        className="py-20 px-8 max-w-[95vw] mx-auto w-full border-b-2 border-border"
        aria-labelledby="how-it-works-heading"
      >
        <div className="text-center mb-12 space-y-3">
          <p className="text-xs font-extrabold tracking-widest text-accent uppercase">A transparent look inside</p>
          <h2 id="how-it-works-heading" className="text-3xl md:text-4xl font-extrabold tracking-tighter uppercase">
            How NEXTUP.AI Works
          </h2>
        </div>

        <p className="text-sm text-muted-foreground max-w-2xl mx-auto text-center leading-relaxed mb-8">
          The flow below keeps the placement feed shared, while your profile and recommendations remain personal to you.
        </p>
        <div className="border-2 border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b-2 border-border bg-muted/20 flex items-center justify-between gap-4 font-mono text-[10px] font-bold tracking-widest uppercase">
            <span className="text-accent">System flow</span>
            <span className="text-muted-foreground">Shared updates to personal view</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5">
            {[
              { icon: Mail, title: "CDC Email Feed", text: "A developer-managed college inbox receives placement announcements, shortlist sheets, and updates." },
              { icon: FileText, title: "Parse & Verify", text: "The system extracts useful details such as company, role, deadline, criteria, and shortlist entries." },
              { icon: Database, title: "Shared Database", text: "Verified opportunity data is saved once and becomes the common source of truth for every user." },
              { icon: Users, title: "Protected Matching", text: "Your profile is compared with eligibility rules and shortlist data without storing your Neo ID as plain text." },
              { icon: BellRing, title: "Your Dashboard", text: "You see relevant drives, status changes, reminders, and applications in one personal workspace." },
            ].map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className={`relative min-h-[230px] p-6 space-y-4 hover:bg-muted/20 transition-colors ${index < 4 ? "border-b-2 lg:border-b-0 lg:border-r-2 border-border" : ""}`}>
                  <span className="font-mono text-[10px] font-bold text-accent">0{index + 1}</span>
                  <div className="w-10 h-10 flex items-center justify-center border-2 border-border text-accent"><Icon size={19} /></div>
                  <div><h3 className="text-sm font-extrabold uppercase tracking-tight">{step.title}</h3><p className="mt-2 text-xs text-muted-foreground leading-relaxed">{step.text}</p></div>
                  {index < 4 && <ArrowRight aria-hidden size={16} className="hidden lg:block absolute -right-[10px] top-1/2 z-10 bg-card text-accent" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <article className="border-2 border-border p-6 space-y-3"><div className="flex items-center gap-2 text-accent"><Shield size={17} /><h3 className="text-xs font-extrabold uppercase tracking-widest">Your PII stays protected</h3></div><p className="text-sm text-muted-foreground leading-relaxed">Sensitive profile data is encrypted before storage. Neo IDs are never kept as readable text; a separate one-way matching token lets us identify a shortlist match while reducing exposure of the original value.</p></article>
          <article className="border-2 border-border p-6 space-y-3"><div className="flex items-center gap-2 text-accent"><Mail size={17} /><h3 className="text-xs font-extrabold uppercase tracking-widest">No personal Gmail connection</h3></div><p className="text-sm text-muted-foreground leading-relaxed">We do not ask to connect, scan, or synchronise your Gmail. Placement content is pulled from the developer-managed inbox, processed once, and served from the shared database.</p></article>
          <article className="border-2 border-border p-6 space-y-3"><div className="flex items-center gap-2 text-accent"><BrainCircuit size={17} /><h3 className="text-xs font-extrabold uppercase tracking-widest">AI is an assistant, not an authority</h3></div><p className="text-sm text-muted-foreground leading-relaxed">AI helps interpret unstructured emails and supports resume tailoring. It can misread a deadline, criteria, attachment, or unusual email format, so always confirm important details with the official CDC source.</p></article>
        </div>

        <div className="mt-6 border-2 border-accent bg-accent/10 p-5 flex flex-col md:flex-row md:items-center gap-4">
          <AlertTriangle size={21} className="text-accent shrink-0" />
          <p className="text-sm leading-relaxed flex-1"><strong>See something wrong?</strong> Report an incorrect parse, missing drive, or mismatched status from the in-app feedback option. The team reviews reports and continually improves the parsing rules and safeguards.</p>
          <Link href={token ? "/dashboard" : "/register"} className="inline-flex items-center justify-center gap-2 border-2 border-border bg-foreground text-background px-4 h-10 text-xs font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-colors shrink-0">{token ? "Open dashboard" : "Get started"}<ArrowRight size={14} /></Link>
        </div>
      </section>

      {/* Privacy Trust Section */}
      <section
        id="security"
        className="py-20 px-8 max-w-[95vw] mx-auto w-full border-b-2 border-border"
        aria-labelledby="security-heading"
      >
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 border border-border bg-muted/30 px-3 py-1 text-[10px] font-extrabold tracking-widest text-accent uppercase">
            <Shield size={12} />
            <span>Privacy First</span>
          </div>
          <h2 id="security-heading" className="text-3xl md:text-4xl font-extrabold tracking-tighter uppercase">
            Your Data Belongs to You
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Your registration number, CGPA, and marks are sensitive. That&apos;s why NEXTUP.AI encrypts
            them in your browser before they ever leave your device. Our servers store only
            scrambled data — even we can&apos;t read it. You hold the only key.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left pt-4">
            {[
              { icon: <Shield size={16} />, label: "Browser-side encryption", desc: "Data is encrypted before upload using AES-256." },
              { icon: <CheckCircle size={16} />, label: "No tracking or ads", desc: "We use only essential authentication cookies." },
              { icon: <Shield size={16} />, label: "Key stays with you", desc: "Your encryption key never leaves your browser session." },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="border-2 border-border p-5 space-y-2">
                <div className="flex items-center gap-2 text-accent">
                  {icon}
                  <span className="text-xs font-extrabold uppercase tracking-wider">{label}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <Link
            href="/privacy"
            className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-muted-foreground hover:text-accent transition-colors underline"
          >
            Read our full Privacy Policy <ArrowRight size={12} />
          </Link>
        </div>
      </section>

      {/* ─── Meet the Builders ─────────────────────────────────────────── */}
      <section
        id="builders"
        className="border-b-2 border-border relative overflow-hidden"
        aria-labelledby="builders-heading"
      >
        {/* hazard-stripe top divider */}
        <div
          aria-hidden
          className="h-3 w-full bg-[repeating-linear-gradient(-45deg,#DFE104,#DFE104_14px,#000_14px,#000_28px)] border-b-2 border-border"
        />

        <div className="py-20 px-8 max-w-[95vw] xl:max-w-7xl mx-auto w-full">
          {/* Header */}
          <div className="text-center mb-14 space-y-4 relative">
            <p className="font-mono text-xs font-extrabold tracking-[0.35em] text-accent uppercase">
              {"// Built by VITians, for VITians"}
            </p>
            <h2
              id="builders-heading"
              className="text-[clamp(2.5rem,8vw,6rem)] font-extrabold tracking-tighter uppercase leading-[0.85]"
            >
              Meet the
              <br />
              <span className="text-transparent [-webkit-text-stroke:2.5px_#DFE104]">
                Builders
              </span>
            </h2>
            <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Two final-year CSE students at VIT Vellore. We built NEXTUP.AI because the placement process was harder to track than it needed to be.
            </p>
            {/* floating side tags (desktop only) */}
            <div aria-hidden className="hidden xl:block absolute left-0 top-8 border border-accent/60 p-4 text-left font-mono text-[10px] text-muted-foreground max-w-[180px]">
              <p className="text-accent font-bold mb-1">{"// OUR MISSION"}</p>
              <p>Empower every VITian to stay ahead in their placement journey.</p>
            </div>
            <div aria-hidden className="hidden xl:block absolute right-0 top-8 border border-accent/60 p-4 text-left font-mono text-[10px] text-muted-foreground max-w-[160px]">
              <p className="text-accent font-bold mb-1">{"// BUILT WITH"}</p>
              <p>Curiosity<br />Iteration<br />&amp; Feedback</p>
            </div>
          </div>

          {/* Builder cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
            {builders.map((b) => (
              <BuilderCard key={b.id} b={b} />
            ))}
          </div>

          {/* Mission quote bar */}
          <div className="mt-12 border-2 border-border bg-card flex flex-col md:flex-row items-stretch">
            <div aria-hidden className="flex items-center justify-center px-6 py-4 bg-accent text-black text-5xl font-extrabold tracking-tighter shrink-0">
              ?
            </div>
            <div className="flex-1 px-6 py-5 flex flex-col justify-center gap-1">
              <p className="text-sm md:text-base font-bold leading-snug">
                Placement season is already stressful. Keeping track of it shouldn&apos;t be.
              </p>
              <p className="font-mono text-sm text-accent font-bold">
                Built by students. Designed for students.
              </p>
            </div>
            <div aria-hidden className="hidden md:flex flex-col justify-center border-l-2 border-border px-5 py-4 font-mono text-[11px] text-muted-foreground leading-relaxed shrink-0">
              <span>&gt; track()</span>
              <span>&gt; prepare()</span>
              <span>
                &gt; ship();<span className="inline-block w-2 h-3 bg-accent ml-1 animate-pulse align-middle" />
              </span>
            </div>
          </div>

          <p className="text-center mt-10 font-mono text-[11px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
            [ TWO BUILDERS • ONE GOAL ]
          </p>
        </div>
      </section>

      {/* FAQ Section */}
      <section
        id="faq"
        className="py-20 px-8 max-w-3xl mx-auto w-full border-b-2 border-border"
        aria-labelledby="faq-heading"
      >
        <div className="text-center mb-12 space-y-3">
          <p className="text-xs font-extrabold tracking-widest text-accent uppercase">Got questions?</p>
          <h2 id="faq-heading" className="text-3xl md:text-4xl font-extrabold tracking-tighter uppercase">
            Frequently Asked Questions
          </h2>
        </div>

        {/* JSON-LD for FAQ — improves Google featured snippets */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: faqs.map(({ q, a }) => ({
                "@type": "Question",
                name: q,
                acceptedAnswer: { "@type": "Answer", text: a },
              })),
            }),
          }}
        />

        <div className="border-2 border-border divide-y divide-border px-6">
          {faqs.map((faq) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-20 px-8 border-b-2 border-border bg-accent" aria-labelledby="cta-heading">
        <div className="max-w-3xl mx-auto text-center space-y-6 text-black">
          <h2 id="cta-heading" className="text-3xl md:text-5xl font-extrabold tracking-tighter uppercase leading-tight">
            Ready to Track Your Placements?
          </h2>
          <p className="font-medium">
            Join VIT students who use NEXTUP.AI to stay on top of every placement opportunity.
            Free forever. No credit card needed.
          </p>
          <Link
            href={token ? "/dashboard" : "/register"}
            className="inline-flex items-center justify-center gap-3 h-14 px-10 border-2 border-black bg-black text-white text-sm font-extrabold tracking-widest uppercase hover:bg-white hover:text-black transition-all active:scale-95"
          >
            {token ? "Go to Dashboard" : "Create Free Account"}
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-border py-12 px-8 bg-muted/10 mt-auto w-full">
        <div className="max-w-[95vw] mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <Link href="/" className="flex items-center">
              <Logo size="md" />
            </Link>
            <nav className="flex items-center flex-wrap justify-center gap-6" aria-label="Footer navigation">
              <Link href="#features" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                Features
              </Link>
              <Link href="/vit-placement-tracker" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                VIT Placement Tracker
              </Link>
              <Link href="#how-it-works" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                How It Works
              </Link>
              <Link href="#builders" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                Builders
              </Link>
              <Link href="#faq" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                FAQ
              </Link>
              <Link href="/terms" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                Terms
              </Link>
              <Link href="/privacy" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                Privacy
              </Link>
              <Link href="/login" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                Sign In
              </Link>
              <Link href="/register" className="text-xs font-bold text-muted-foreground hover:text-accent transition-colors uppercase tracking-widest">
                Register
              </Link>
            </nav>
          </div>
          <div className="border-t border-border mt-8 pt-6 text-center">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              © {new Date().getFullYear()} NEXTUP.AI · Designed for VIT Vellore · Not affiliated with VIT or CDC
            </p>
          </div>
        </div>
      </footer>

    </main>
  );
}
