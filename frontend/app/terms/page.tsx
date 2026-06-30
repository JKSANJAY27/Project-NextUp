import React from "react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Read the Terms of Service for NEXTUP.AI — the placement tracking platform for VIT Vellore students.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex h-20 items-center justify-between border-b-2 border-border px-8 md:px-16">
        <Link
          href="/"
          className="text-xl font-extrabold tracking-tighter uppercase"
        >
          NEXTUP<span className="text-accent">.AI</span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            href="/privacy"
            className="text-xs font-bold tracking-widest uppercase hover:text-accent transition-colors"
          >
            Privacy Policy
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
            <span>📄 LEGAL DOCUMENT</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter uppercase leading-tight">
            Terms of Service
          </h1>
          <p className="text-sm text-muted-foreground">
            Last updated: June 2026 · Effective immediately upon account creation
          </p>
        </header>

        {/* Sections */}
        <section className="space-y-8 text-sm leading-relaxed">

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              1. About NEXTUP.AI
            </h2>
            <p className="text-muted-foreground">
              NEXTUP.AI is a free, student-built placement tracking platform designed for students of
              VIT Vellore (Vellore Institute of Technology). It is{" "}
              <strong className="text-foreground">not</strong> an official product of VIT or the
              Career Development Centre (CDC). We help students track campus placement drives,
              receive shortlist notifications, manage their applications, and prepare their resumes.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              2. Eligibility
            </h2>
            <p className="text-muted-foreground">
              You must be a current or former student of VIT Vellore to create an account. By
              registering, you confirm that you meet this requirement and that the information you
              provide is accurate.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              3. Account & Security
            </h2>
            <p className="text-muted-foreground">
              You are responsible for keeping your account credentials confidential. Do not share
              your password with anyone. NEXTUP.AI uses your password to derive an encryption key in
              your browser — the server never receives your raw password. If you change your
              password, your encryption key changes and you will need to re-enter sensitive profile
              data (registration number, CGPA, marks).
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              4. Data Privacy & Encryption
            </h2>
            <p className="text-muted-foreground">
              Sensitive data — including your registration number, CGPA, grades, and Gmail tokens —
              is encrypted with AES-256 in your browser before being sent to our servers. We store
              only encrypted data and cannot read your raw personal information. For full details,
              see our{" "}
              <Link href="/privacy" className="text-accent underline hover:no-underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              5. Gmail Integration
            </h2>
            <p className="text-muted-foreground">
              If you connect your Gmail account, NEXTUP.AI will access your inbox to parse CDC
              placement emails and detect shortlists. We read only emails matching placement-related
              subjects from official VIT/CDC senders. We do not read, store, or share any other
              emails. Your Gmail OAuth token is encrypted and stored securely.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              6. User Responsibilities
            </h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Do not use NEXTUP.AI for any unlawful purpose.</li>
              <li>Do not attempt to access another student&apos;s data.</li>
              <li>Do not reverse-engineer or scrape the platform.</li>
              <li>
                Do not use the platform to violate VIT CDC placement rules or regulations.
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              7. AI Toolkit
            </h2>
            <p className="text-muted-foreground">
              The AI Toolkit downloads a small AI model that runs entirely in your browser. No
              resume content or job description text is sent to any external AI provider. By using
              the AI Toolkit, you consent to the model files being cached in your browser&apos;s
              storage. You can clear these at any time via your browser settings.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              8. Disclaimers
            </h2>
            <p className="text-muted-foreground">
              NEXTUP.AI is provided &quot;as is&quot; without any warranty. We are not responsible
              for missed placements, incorrect eligibility calculations, or data loss due to browser
              issues. Placement eligibility displayed is based on your entered profile data — always
              verify with the official VIT CDC portal.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              9. Changes to These Terms
            </h2>
            <p className="text-muted-foreground">
              We may update these Terms from time to time. Continued use of NEXTUP.AI after changes
              constitutes acceptance of the revised Terms.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-extrabold uppercase tracking-tight">
              10. Contact
            </h2>
            <p className="text-muted-foreground">
              For questions about these Terms, use the feedback form available inside the platform
              after logging in. NEXTUP.AI is maintained by VIT Vellore students on a volunteer
              basis.
            </p>
          </div>
        </section>
      </article>

      {/* Footer */}
      <footer className="border-t-2 border-border py-8 px-8 text-center bg-muted/10">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          © {new Date().getFullYear()} NEXTUP.AI ·{" "}
          <Link href="/privacy" className="hover:text-accent transition-colors">
            Privacy Policy
          </Link>{" "}
          · Designed for VIT Vellore
        </p>
      </footer>
    </main>
  );
}
