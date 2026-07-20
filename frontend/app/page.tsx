"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import Tooltip from "@/components/Tooltip";
import Logo from "@/components/Logo";

// ─── FAQ Data ─────────────────────────────────────────────────────────────────
const faqs = [
  {
    q: "What exactly does NEXTUP.AI do?",
    a: "NEXTUP.AI is a smart placement tracker for VIT Vellore students. It automatically reads your CDC emails, detects when you're shortlisted for a company, checks if you're eligible for upcoming drives, and keeps all your applications organised in one place — so you never miss an opportunity.",
  },
  {
    q: "Is NEXTUP.AI free to use?",
    a: "Yes, completely free. NEXTUP.AI is built and maintained by VIT students for VIT students. There are no subscription fees, hidden charges, or premium tiers.",
  },
  {
    q: "How does the automatic shortlist detection work?",
    a: "You connect your college Gmail account once. NEXTUP.AI then monitors incoming CDC emails in the background. When a shortlist Excel sheet arrives, the platform checks whether your registration number appears — and notifies you instantly, without you having to open the email or manually scan the spreadsheet.",
  },
  {
    q: "Is my personal data safe?",
    a: "Your most sensitive data — registration number, CGPA, marks — is encrypted right in your browser before anything is sent to our servers. We physically cannot read it. Even if someone accessed our database, they would only see random encrypted blobs. You hold the only key.",
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
    role: "Software Developer & AI Engineer",
    photo: "/images/peeps/sanjay.jfif",
    bio: "I love building systems that think. From LLM pipelines to real-time AI apps, I enjoy solving complex problems and turning ideas into scalable, intelligent products.",
    whoami: "engineers full-stack systems, then teaches them to think",
    stats: [
      { k: "CGPA", v: "9.34" },
      { k: "GATE AIR", v: "1603" },
    ],
    expertise: ["Software Engineering", "AI / LLM Systems", "Full-Stack", "System Design"],
    highlight: "UKIERI International Research Scholar · Builds production-grade AI systems",
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
    role: "Software Developer & AI Engineer",
    photo: "/images/peeps/hariprasad.jfif",
    bio: "I build end-to-end solutions with clean code and smart design. Whether it's ML models, full-stack apps or optimizing workflows, I love shipping real value.",
    whoami: "builds the model, then ships it into a real product",
    stats: [
      { k: "CGPA", v: "9.06" },
      { k: "Internships", v: "2" },
    ],
    expertise: ["Machine Learning", "Deep Learning", "Full Stack", "Python", "React", "AWS"],
    highlight: "Finalist, India Innovates 2026 · Ships end-to-end ML products",
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
            <span className="text-muted-foreground">{b.whoami}</span>
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

          <p className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground border-l-2 border-accent pl-3">
            {b.highlight}
          </p>

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
                  title={l.label}
                  className="flex-1 flex items-center justify-center py-2.5 text-muted-foreground hover:bg-accent hover:text-black transition-colors"
                >
                  <l.icon size={15} />
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

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col font-sans">

      {/* Navigation */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 md:px-16 w-full bg-background z-10 sticky top-0 backdrop-blur-md">
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
          <Link
            href={token ? "/dashboard" : "/register"}
            className="flex items-center justify-center border-2 border-border bg-foreground text-background px-6 h-10 text-xs font-bold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95"
          >
            {token ? "Dashboard" : "Get Started Free"}
          </Link>
        </nav>
      </header>

      {/* Marquee — benefit-focused, no jargon */}
      <div className="border-b-2 border-border bg-accent py-4 overflow-hidden select-none" aria-hidden="true">
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

      {/* Hero Section */}
      <section
        className="flex flex-col items-center justify-center text-center py-24 px-8 border-b-2 border-border max-w-[95vw] mx-auto w-full"
        aria-labelledby="hero-heading"
      >
        <div className="space-y-6 max-w-4xl">
          <div className="inline-flex items-center gap-2 border-2 border-border bg-muted/30 px-4 py-2 text-xs font-extrabold tracking-widest text-accent uppercase">
            <Bell size={14} />
            <span>Free Placement Tracker for VIT Vellore Students</span>
          </div>

          <h1
            id="hero-heading"
            className="text-[clamp(2.5rem,10vw,8rem)] font-extrabold tracking-tighter uppercase leading-[0.85] text-foreground"
          >
            Never Miss
            <br />
            a Shortlist
          </h1>

          <p className="text-lg md:text-xl font-medium text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            NEXTUP.AI automatically reads your CDC emails, detects shortlists, checks eligibility,
            and keeps all your applications organised — so you can focus on preparing, not tracking.
          </p>

          <div className="pt-8 flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href={token ? "/dashboard" : "/register"}
              className="flex items-center justify-center gap-3 h-16 px-10 border-2 border-border bg-foreground text-background text-sm font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all"
              aria-label={token ? "Go to dashboard" : "Register for free"}
            >
              <span>{token ? "Go to Dashboard" : "Get Started — It's Free"}</span>
              <ArrowRight size={16} />
            </Link>
            <Link
              href="#how-it-works"
              className="flex items-center justify-center h-16 px-10 border-2 border-border bg-transparent text-foreground text-sm font-extrabold tracking-widest uppercase hover:bg-muted transition-all active:scale-95"
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

      {/* How It Works */}
      <section
        id="how-it-works"
        className="py-20 px-8 max-w-[95vw] mx-auto w-full border-b-2 border-border"
        aria-labelledby="how-it-works-heading"
      >
        <div className="text-center mb-16 space-y-3">
          <p className="text-xs font-extrabold tracking-widest text-accent uppercase">Simple Setup</p>
          <h2 id="how-it-works-heading" className="text-3xl md:text-4xl font-extrabold tracking-tighter uppercase">
            Up &amp; Running in 3 Steps
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-2 border-border">
          {[
            {
              step: "01",
              title: "Create Your Account",
              description:
                "Register with your college email. Your profile is set up in minutes — no complex configuration required.",
            },
            {
              step: "02",
              title: "Set Up Your Profile",
              description:
                "Enter your CGPA, branch, and registration number. This lets NEXTUP.AI check your eligibility for each drive automatically.",
            },
            {
              step: "03",
              title: "Connect Gmail & Relax",
              description:
                "Connect your college Gmail once. From that point, NEXTUP.AI monitors for shortlists and new drives around the clock.",
            },
          ].map((item, i) => (
            <div
              key={i}
              className={`p-10 space-y-4 hover:bg-muted/10 transition-colors ${
                i < 2 ? "border-b-2 md:border-b-0 md:border-r-2 border-border" : ""
              }`}
            >
              <div className="text-6xl font-extrabold tracking-tighter text-accent/20">{item.step}</div>
              <h3 className="text-xl font-bold uppercase tracking-tighter">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link
            href={token ? "/dashboard" : "/register"}
            className="inline-flex items-center justify-center gap-3 h-14 px-10 border-2 border-border bg-foreground text-background text-sm font-extrabold tracking-widest uppercase hover:bg-accent hover:text-black hover:border-accent hover:scale-105 active:scale-95 transition-all"
          >
            {token ? "Back to Dashboard" : "Start Tracking for Free"}
            <ArrowRight size={16} />
          </Link>
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
              We&apos;re two final-year CSE students at VIT Vellore building NEXTUP.AI to make
              placement tracking smarter, simpler and actually useful.
            </p>
            {/* floating side tags (desktop only) */}
            <div aria-hidden className="hidden xl:block absolute left-0 top-8 border border-accent/60 p-4 text-left font-mono text-[10px] text-muted-foreground max-w-[180px]">
              <p className="text-accent font-bold mb-1">{"// OUR MISSION"}</p>
              <p>Empower every VITian to stay ahead in their placement journey.</p>
            </div>
            <div aria-hidden className="hidden xl:block absolute right-0 top-8 border border-accent/60 p-4 text-left font-mono text-[10px] text-muted-foreground max-w-[160px]">
              <p className="text-accent font-bold mb-1">{"// BUILT WITH"}</p>
              <p>Passion<br />Code<br />&amp; Late Nights</p>
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
              {"//"}
            </div>
            <div className="flex-1 px-6 py-5 flex flex-col justify-center gap-1">
              <p className="text-sm md:text-base font-bold leading-snug">
                We built NEXTUP.AI for every VITian who&apos;s tired of scattered spreadsheets and missed opportunities.
              </p>
              <p className="font-mono text-sm text-accent font-bold">
                One platform. All your placements.
              </p>
            </div>
            <div aria-hidden className="hidden md:flex flex-col justify-center border-l-2 border-border px-5 py-4 font-mono text-[11px] text-muted-foreground leading-relaxed shrink-0">
              <span>&gt; track()</span>
              <span>&gt; prepare()</span>
              <span>
                &gt; succeed();<span className="inline-block w-2 h-3 bg-accent ml-1 animate-pulse align-middle" />
              </span>
            </div>
          </div>

          <p className="text-center mt-10 font-mono text-[11px] font-bold tracking-[0.3em] text-muted-foreground uppercase">
            🚀 [ Let&apos;s build the future together ]
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
