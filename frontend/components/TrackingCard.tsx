import React, { useState, useRef, useEffect } from "react";
import { Company, Application, CompanyEvent } from "@/app/tracking/types";
import { Archive, HelpCircle } from "lucide-react";
import api from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export const STAGE_COLORS = {
  REGISTRATION: "border-yellow-500 bg-yellow-500/5",
  SHORTLISTED: "border-blue-500 bg-blue-500/5",
  ONLINE_ASSESSMENT: "border-orange-500 bg-orange-500/5",
  INTERVIEW: "border-purple-500 bg-purple-500/5",
  OFFER: "border-emerald-500 bg-emerald-500/5",
  REJECTED: "border-red-500 bg-red-500/5",
};

// Maps each phase to the status value sent to the backend
const PHASE_STATUS_MAP: Record<string, string> = {
  Registration: "Applied",
  "Online Assessment": "OA",
  Interview: "Interview",
  "Offer Received": "Offer",
  Rejected: "Rejected",
};

const PHASES = Object.keys(PHASE_STATUS_MAP);

// Phase label colours for the dropdown
const PHASE_PILL: Record<string, string> = {
  Registration: "text-yellow-400 border-yellow-500/40 hover:bg-yellow-500/10",
  "Online Assessment": "text-orange-400 border-orange-500/40 hover:bg-orange-500/10",
  Interview: "text-purple-400 border-purple-500/40 hover:bg-purple-500/10",
  "Offer Received": "text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10",
  Rejected: "text-red-400 border-red-500/40 hover:bg-red-500/10",
};

interface TrackingCardProps {
  company: Company;
  application: Application;
  nextEvent?: CompanyEvent | null;
  stage: keyof typeof STAGE_COLORS;
  onClick: () => void;
  onArchive?: () => void;
}

export default function TrackingCard({
  company,
  application,
  nextEvent,
  stage,
  onClick,
  onArchive,
}: TrackingCardProps) {
  const colorClass = STAGE_COLORS[stage] || "border-border bg-card";
  const queryClient = useQueryClient();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const handleMoveToPhase = async (phase: string) => {
    setDropdownOpen(false);
    setMoving(true);
    try {
      const newStatus = PHASE_STATUS_MAP[phase];
      await api.patch(`/applications/${application.id}`, { status: newStatus });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    } catch (err) {
      console.error("Failed to move phase:", err);
      alert("Failed to change phase. Please try again.");
    } finally {
      setMoving(false);
    }
  };

  // Last update
  const lastUpdate = application.last_user_activity_at
    ? new Date(application.last_user_activity_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "—";

  // Next event string
  let nextEventStr = "—";
  if (nextEvent && nextEvent.timestamp) {
    const d = new Date(nextEvent.timestamp);
    nextEventStr = `${nextEvent.event_type} • ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  }

  return (
    <div
      onClick={onClick}
      className={`border-2 border-l-4 p-4 cursor-pointer hover:-translate-y-1 transition-all duration-200 flex flex-col gap-3 group relative ${colorClass} ${moving ? "opacity-50 pointer-events-none" : ""}`}
    >
      {/* Header Row */}
      <div className="flex justify-between items-start gap-2">
        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-background border border-border text-foreground">
          {company.category}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {/* Phase correction button */}
          <div
            ref={dropdownRef}
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen((v) => !v);
              }}
              className="group/q relative p-1 text-muted-foreground hover:text-accent border border-transparent hover:border-accent/30 hover:bg-accent/10 transition-all rounded"
              title="Is the drive placed in the wrong phase?"
              aria-label="Change phase"
            >
              <HelpCircle size={12} />
              {/* Tooltip */}
              <span className="pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-[180px] rounded bg-background border border-border px-2 py-1 text-[10px] font-bold text-foreground tracking-wide opacity-0 group-hover/q:opacity-100 transition-opacity duration-150 z-50 shadow-lg whitespace-normal leading-snug">
                Is the drive placed in the wrong phase?
              </span>
            </button>

            {/* Phase dropdown */}
            {dropdownOpen && (
              <div className="absolute top-full right-0 mt-1 z-50 bg-background border-2 border-border shadow-xl rounded overflow-hidden min-w-[170px]">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border">
                  Move to phase
                </p>
                {PHASES.map((phase) => (
                  <button
                    key={phase}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveToPhase(phase);
                    }}
                    className={`w-full text-left px-3 py-2 text-[11px] font-bold border-b border-border/40 last:border-b-0 transition-all ${PHASE_PILL[phase]}`}
                  >
                    {phase}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Archive button */}
          {onArchive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
              className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all rounded shrink-0"
              title="Archive application"
            >
              <Archive size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Main Info */}
      <div>
        <h3 className="font-black text-base uppercase tracking-tighter truncate group-hover:text-accent transition-colors flex items-center gap-2 flex-wrap">
          <span>{company.name}</span>
          {company.latest_event && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[7px] font-black bg-amber-500/20 text-amber-500 border border-amber-500/30 animate-pulse tracking-wider normal-case">
              ⚡ {company.latest_event.event_type.replace(/_/g, ' ')}
            </span>
          )}
        </h3>
        <p className="text-xs text-muted-foreground uppercase truncate font-bold">
          {company.role}
        </p>
      </div>

      {/* Grid details */}
      <div className="grid grid-cols-2 gap-4 mt-2">
        <div>
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Current Stage</p>
          <p className="text-xs font-black uppercase truncate">{application.status || "—"}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Last Update</p>
          <p className="text-xs font-black uppercase truncate">{lastUpdate}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border pt-3 mt-1 flex justify-between items-center bg-background/50 -mx-4 -mb-4 p-3 px-4">
        <div>
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Package</p>
          <p className="text-[10px] font-mono font-bold uppercase">{company.ctc || "TBD"}</p>
          <p className="text-[9px] text-muted-foreground uppercase mt-1">
            Stipend: <span className="font-mono font-bold text-foreground">{company.stipend || "TBD"}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Next Event</p>
          <p className="text-[10px] font-black uppercase truncate">{nextEventStr}</p>
        </div>
      </div>
    </div>
  );
}

