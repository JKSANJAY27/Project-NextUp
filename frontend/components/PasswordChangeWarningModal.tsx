"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface PasswordChangeWarningModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Warning modal shown when the user attempts to change their password.
 *
 * Because NEXTUP.AI derives the AES-256 encryption key from the user's
 * password, changing the password means the key changes — and all previously
 * encrypted data (registration number, CGPA, etc.) can no longer be decrypted.
 * The user must be clearly warned before proceeding.
 */
export default function PasswordChangeWarningModal({
  open,
  onConfirm,
  onCancel,
}: PasswordChangeWarningModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md bg-background border-2 border-yellow-500 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-yellow-500 bg-yellow-500/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-yellow-500" />
            <h2
              id="pw-warning-title"
              className="text-sm font-extrabold uppercase tracking-widest text-yellow-500"
            >
              Important — Read Before Continuing
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cancel password change"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-4 text-sm">
          <p className="font-bold text-foreground">
            Changing your password will reset your personal encryption key.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            NEXTUP.AI uses your password to generate a unique encryption key in your browser. This
            key protects your sensitive data — including your registration number, CGPA, academic
            marks, and Gmail connection.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            After changing your password, your old encrypted data{" "}
            <strong className="text-yellow-500">cannot be recovered automatically</strong>. You will
            need to re-enter the following in your profile:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
            <li>Registration Number (Neo ID)</li>
            <li>CGPA</li>
            <li>10th and 12th marks</li>
            <li>Gmail connection (if connected)</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Your application tracking history, announcements, and calendar events are{" "}
            <strong className="text-foreground">not affected</strong> — only the above personal
            details need re-entering.
          </p>
        </div>

        {/* Footer */}
        <div className="border-t-2 border-border px-6 py-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 h-10 border-2 border-border text-xs font-bold uppercase tracking-widest hover:bg-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 h-10 bg-yellow-500 text-black text-xs font-extrabold uppercase tracking-widest border-2 border-yellow-500 hover:bg-yellow-400 transition-all active:scale-95"
          >
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
