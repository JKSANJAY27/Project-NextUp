import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Understand how NEXTUP.AI handles your data — zero tracking, client-side encryption, and privacy by design.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 md:px-16">
        <Link
          href="/"
          className="flex items-center"
        >
          <Logo size="md" />
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            href="/"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors"
          >
            Back to Home
          </Link>
          <Link
            href="/terms"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/login"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors"
          >
            Sign In
          </Link>
        </nav>
      </header>

      {/* Content */}
      <article className="max-w-3xl mx-auto px-6 md:px-8 py-16 space-y-12">
        <header className="space-y-4 border-b-2 border-border pb-8">
          <div className="inline-flex items-center gap-2 border border-border bg-muted/30 px-3 py-1 text-[10px] font-extrabold tracking-widest text-accent uppercase">
            <span>🔒 PRIVACY FIRST</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter uppercase leading-tight">
            Privacy Policy
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: June 2026 · NEXTUP.AI is built with privacy as a first principle.
          </p>
        </header>

        <section className="space-y-8 text-sm leading-relaxed">

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              1. Our Privacy Philosophy
            </h2>
            <p className="text-muted-foreground">
              NEXTUP.AI is built on a &quot;privacy by design&quot; principle. We collect the minimum
              data necessary to operate the platform. Your most sensitive information — including
              your registration number, CGPA, and academic marks — is encrypted in your browser
              before reaching our servers, so even we cannot read it.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              2. What Data We Collect
            </h2>
            <div className="space-y-4">
              <div>
                <p className="font-bold text-foreground mb-2">Account Data (stored as plaintext):</p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>Email address (used for authentication via Supabase)</li>
                  <li>Full name and branch (e.g., CSE, ECE)</li>
                  <li>Batch year and degree type</li>
                </ul>
              </div>
              <div>
                <p className="font-bold text-foreground mb-2">Sensitive Data (stored as AES-256 encrypted blobs — we cannot read this):</p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>VIT Registration Number (Neo ID)</li>
                  <li>CGPA, 10th marks, 12th marks</li>
                  <li>Application notes and status updates</li>
                </ul>
              </div>
              <div>
                <p className="font-bold text-foreground mb-2">Usage Data:</p>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                  <li>Application tracking history (companies, stages)</li>
                  <li>Calendar events and placement deadlines</li>
                  <li>Parsed email metadata (subject, sender, parsed drive details)</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              3. How Encryption Works
            </h2>
            <p className="text-muted-foreground">
              When you log in, your browser derives an encryption key from your password. Sensitive
              profile fields are encrypted before storage, while a separate one-way matching token
              is used where the service needs to identify a shortlist match without keeping your
              Neo ID as plain text.
            </p>
            <p className="text-muted-foreground">
              Sensitive data is encrypted before upload and decrypted when needed by the protected
              application flow. Our database does not keep your Neo ID as a readable value.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              4. Cookies & Local Storage
            </h2>
            <p className="text-muted-foreground">
              We use only <strong className="text-foreground">essential cookies</strong> required for
              authentication (Supabase session cookies). We do{" "}
              <strong className="text-foreground">not</strong> use tracking cookies, analytics
              cookies, advertising cookies, or any third-party tracking scripts.
            </p>
            <p className="text-muted-foreground">
              We store your Zustand session state (user profile and auth token) in
              <code className="text-accent bg-muted px-1">localStorage</code> to keep you logged in
              across browser refreshes. This does not include your encryption key.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              5. Gmail Access
            </h2>
            <p className="text-muted-foreground">
              NEXTUP.AI does not ask for access to your Gmail account and does not sync or scan your
              personal inbox. Placement updates are collected from a developer-managed college inbox,
              processed once, and then served from the shared opportunity database to all users.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              6. Third-Party Services
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">Supabase</strong> — provides authentication and
                database hosting. Data stored on Supabase is subject to{" "}
                <a
                  href="https://supabase.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  Supabase&apos;s Privacy Policy
                </a>
                .
              </li>
            </ul>
            <p className="text-muted-foreground">
              We do not use Google Analytics, Meta Pixel, Hotjar, or any other third-party
              analytics or advertising tools.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              7. Data Retention & Deletion
            </h2>
            <p className="text-muted-foreground">
              Your account data is retained for as long as your account is active. You may delete
              your account at any time by contacting us through the in-app feedback form. Account
              deletion removes all your data from our servers within 30 days.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              8. Your Rights
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Right to access your personal data</li>
              <li>Right to correct inaccurate data</li>
              <li>Right to delete your account and all associated data</li>
              <li>Right to disconnect Gmail at any time</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              9. Contact
            </h2>
            <p className="text-muted-foreground">
              For any privacy concerns, use the feedback form inside the platform. NEXTUP.AI is a
              student project maintained voluntarily — we will respond as promptly as possible.
            </p>
          </div>
        </section>
      </article>

      {/* Footer */}
      <footer className="border-t-2 border-border py-8 px-8 text-center bg-muted/10">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          © {new Date().getFullYear()} NEXTUP.AI ·{" "}
          <Link href="/terms" className="hover:text-accent transition-colors">
            Terms of Service
          </Link>{" "}
          · Designed for VIT Vellore
        </p>
      </footer>
    </main>
  );
}
