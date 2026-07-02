import React from "react";

interface ConfirmArchiveModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmArchiveModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmArchiveModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background/85 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="bg-card border-2 border-red-500/80 max-w-md w-full flex flex-col p-6 relative shadow-2xl animate-in fade-in zoom-in-95 duration-200 rounded-none">
        <h3 className="text-xl font-black uppercase tracking-tighter text-red-500 flex items-center gap-2">
          <span>⚠️</span> {title}
        </h3>
        <p className="text-xs text-muted-foreground uppercase leading-relaxed mt-4 font-bold">
          {message}
        </p>
        <div className="flex gap-4 mt-6">
          <button
            onClick={onConfirm}
            className="flex-1 h-10 border-2 border-red-500 bg-red-500 text-black font-black text-xs uppercase tracking-wider hover:bg-red-600 hover:border-red-600 transition-all active:scale-95"
          >
            Yes, Archive
          </button>
          <button
            onClick={onCancel}
            className="flex-1 h-10 border-2 border-border bg-transparent text-foreground font-bold text-xs uppercase tracking-wider hover:bg-muted transition-all active:scale-95"
          >
            No, Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
