import React from "react";
import { Sparkles, Check, X, Clock } from "lucide-react";
import CompensationDisplay from "@/components/CompensationDisplay";

interface Company {
  id: string;
  name: string;
  role: string;
  category: string;
  ctc?: string | null;
  stipend?: string | null;
  job_location?: string | null;
  registration_deadline?: string | null;
}

interface SuggestedTrackingCardProps {
  company: Company;
  inferredStage: string | null; // "OA" | "Interview" | "Offer"
  onAccept: () => void;
  onDecline: () => void;
  onLater: () => void;
  isProcessing?: boolean;
}

export default function SuggestedTrackingCard({
  company,
  inferredStage,
  onAccept,
  onDecline,
  onLater,
  isProcessing = false,
}: SuggestedTrackingCardProps) {
  const stageDisplay = inferredStage || "Participation";

  return (
    <div
      className={`border border-l-4 border-l-purple-500 border-border bg-card text-card-foreground p-4 flex flex-col gap-3 relative transition-all duration-200 ${
        isProcessing ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      {/* Top Banner */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/30 rounded flex items-center gap-1">
          <Sparkles size={10} /> Suggested Tracking
        </span>
        <span className="text-[9px] font-bold text-muted-foreground uppercase">
          {company.category}
        </span>
      </div>

      {/* Main Info */}
      <div>
        <h3 className="font-black text-base uppercase tracking-tighter truncate text-foreground">
          {company.name}
        </h3>
        <p className="text-xs text-muted-foreground uppercase truncate font-bold">
          {company.role}
        </p>
      </div>

      {/* Evidence Badge / Explanation */}
      <div className="bg-purple-500/10 border border-purple-500/20 p-2.5 rounded text-xs">
        <p className="text-purple-700 dark:text-purple-300 font-medium text-[11px] leading-snug">
          We found historical email evidence that you participated in this drive up to{" "}
          <strong className="text-purple-800 dark:text-purple-200 font-bold uppercase underline underline-offset-2">
            {stageDisplay}
          </strong>.
        </p>
      </div>

      {/* Package & Location */}
      <div className="flex justify-between items-center text-xs">
        <div>
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            Package
          </p>
          <CompensationDisplay value={company.ctc} mode="card" />
        </div>
        {company.stipend && (
          <div className="text-right">
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
              Stipend
            </p>
            <p className="text-xs font-mono font-bold text-foreground">
              {company.stipend}
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="border-t border-border pt-3 mt-1 grid grid-cols-3 gap-2">
        <button
          onClick={onAccept}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] uppercase tracking-wider rounded transition-colors"
          title="Yes, I participated. Create tracking workspace."
        >
          <Check size={12} /> Yes
        </button>

        <button
          onClick={onDecline}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-muted hover:bg-red-500/20 hover:text-red-400 text-muted-foreground font-bold text-[11px] uppercase tracking-wider border border-border rounded transition-colors"
          title="No, I didn't participate. Move to archived."
        >
          <X size={12} /> No
        </button>

        <button
          onClick={onLater}
          className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-muted hover:bg-muted/80 text-muted-foreground font-bold text-[11px] uppercase tracking-wider border border-border rounded transition-colors"
          title="Decide later. Keep in Action Center for 7 days."
        >
          <Clock size={12} /> Later
        </button>
      </div>
    </div>
  );
}
