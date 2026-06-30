"use client";

import React, { useEffect, useState } from "react";
import { BrainCircuit, Download, X, CheckCircle } from "lucide-react";

const CONSENT_KEY = "nextup-llm-consent";

interface BrowserLLMConsentModalProps {
  onAccept: () => void;
  onSkip: () => void;
}

/**
 * Consent modal shown the first time a user opens the AI Toolkit.
 * Explains that a local AI model (~50–200 MB) will be downloaded and
 * run entirely in the browser — no data is sent to external AI servers.
 *
 * Stores consent in localStorage so it only shows once.
 */
export default function BrowserLLMConsentModal({
  onAccept,
  onSkip,
}: BrowserLLMConsentModalProps) {
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY);
    if (!consent) {
      setOpen(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    setOpen(false);
    onAccept();
  };

  const handleSkip = () => {
    setOpen(false);
    onSkip();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="llm-consent-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" aria-hidden="true" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-background border-2 border-accent shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-border bg-accent/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <BrainCircuit size={20} className="text-accent" />
            <h2
              id="llm-consent-title"
              className="text-sm font-extrabold uppercase tracking-widest"
            >
              AI Toolkit — Local Model Setup
            </h2>
          </div>
          <button
            onClick={handleSkip}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Skip AI model installation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-4">
          <p className="text-sm font-bold text-foreground">
            The AI Toolkit runs a small AI model directly in your browser.
          </p>

          <div className="space-y-3">
            {[
              {
                icon: Download,
                title: "One-time download (~50–200 MB)",
                desc: "The AI model is downloaded once and cached in your browser. Future visits load it instantly.",
              },
              {
                icon: BrainCircuit,
                title: "Runs 100% locally",
                desc: "All AI analysis happens in your browser. Your resume and job description text never leave your device.",
              },
              {
                icon: CheckCircle,
                title: "No external AI servers",
                desc: "We do not send your data to OpenAI, Gemini, or any third-party AI service. Everything stays on your machine.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 text-xs">
                <Icon size={14} className="text-accent mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-foreground">{title}</p>
                  <p className="text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-4">
            By proceeding, you allow NEXTUP.AI to download and store the AI model files in your
            browser&apos;s cache (IndexedDB). You can clear these at any time through your browser
            settings.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t-2 border-border px-6 py-4 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-yellow-400 cursor-pointer"
            />
            <span className="text-xs font-bold text-foreground group-hover:text-accent transition-colors">
              I understand and allow the local AI model to be downloaded
            </span>
          </label>

          <div className="flex gap-3">
            <button
              onClick={handleSkip}
              className="flex-1 h-10 border-2 border-border text-xs font-bold uppercase tracking-widest hover:bg-muted transition-all"
            >
              Skip for now
            </button>
            <button
              onClick={handleAccept}
              disabled={!checked}
              className="flex-1 h-10 bg-accent text-black text-xs font-extrabold uppercase tracking-widest border-2 border-accent hover:bg-yellow-300 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              <Download size={14} />
              Install AI Model
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
