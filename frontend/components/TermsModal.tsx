"use client";

import React from "react";
import Link from "next/link";
import { X, ShieldCheck, ExternalLink } from "lucide-react";

interface TermsModalProps {
  open: boolean;
  agreed: boolean;
  onToggle: (v: boolean) => void;
  onClose: () => void;
}

/**
 * Modal displayed on the register page.
 * User must check the agreement checkbox before they can submit.
 * Controlled externally via open/agreed/onToggle/onClose props.
 */
export default function TermsModal({ open, agreed, onToggle, onClose }: TermsModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-lg bg-background border-2 border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <ShieldCheck size={18} className="text-accent" />
            <h2 id="terms-modal-title" className="text-sm font-extrabold uppercase tracking-widest">
              Terms & Privacy
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close terms modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="max-h-64 overflow-y-auto px-6 py-4 text-xs text-muted-foreground space-y-3 leading-relaxed">
          <p>
            By creating an account on NEXTUP.AI, you agree that:
          </p>
          <ul className="list-disc pl-4 space-y-2">
            <li>You are a current or former student of VIT Vellore.</li>
            <li>You will not share account credentials or attempt to access others&apos; data.</li>
            <li>
              Your sensitive profile data (registration number, CGPA, grades) is encrypted in your
              browser. NEXTUP.AI servers store only encrypted blobs — we cannot read your raw data.
            </li>
            <li>
              If you change your password, your encryption key will change and you will need to
              re-enter sensitive profile details.
            </li>
            <li>
              NEXTUP.AI is a student project and is not officially affiliated with VIT Vellore or
              VIT CDC.
            </li>
            <li>
              You grant NEXTUP.AI permission to access your Gmail account to parse placement emails
              (only when you connect Gmail in settings).
            </li>
          </ul>
          <p>
            For full details, please read our{" "}
            <Link
              href="/terms"
              target="_blank"
              className="text-accent underline hover:no-underline inline-flex items-center gap-1"
            >
              Terms of Service <ExternalLink size={10} />
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              target="_blank"
              className="text-accent underline hover:no-underline inline-flex items-center gap-1"
            >
              Privacy Policy <ExternalLink size={10} />
            </Link>
            .
          </p>
        </div>

        {/* Footer */}
        <div className="border-t-2 border-border px-6 py-4 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => onToggle(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-yellow-400 cursor-pointer"
              id="terms-agree-checkbox"
            />
            <span className="text-xs font-bold text-foreground group-hover:text-accent transition-colors">
              I have read and agree to the Terms of Service and Privacy Policy
            </span>
          </label>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 h-10 border-2 border-border text-xs font-bold uppercase tracking-widest hover:bg-muted transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onClose}
              disabled={!agreed}
              className="flex-1 h-10 bg-foreground text-background text-xs font-extrabold uppercase tracking-widest border-2 border-border hover:bg-accent hover:text-black hover:border-accent transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
