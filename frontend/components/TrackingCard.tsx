import React from "react";
import { Company, Application, CompanyEvent } from "@/app/tracking/types";
import { Archive } from "lucide-react";


export const STAGE_COLORS = {
  REGISTRATION: "border-yellow-500 bg-yellow-500/5",
  SHORTLISTED: "border-blue-500 bg-blue-500/5",
  ONLINE_ASSESSMENT: "border-orange-500 bg-orange-500/5",
  INTERVIEW: "border-purple-500 bg-purple-500/5",
  OFFER: "border-emerald-500 bg-emerald-500/5",
  REJECTED: "border-red-500 bg-red-500/5",
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
      className={`border-2 border-l-4 p-4 cursor-pointer hover:-translate-y-1 transition-all duration-200 flex flex-col gap-3 group ${colorClass}`}
    >
      {/* Header Row */}
      <div className="flex justify-between items-start">
        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-background border border-border text-foreground">
          {company.category}
        </span>
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
          <p className="text-[10px] font-mono font-bold uppercase">{company.ctc || company.stipend || "TBD"}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Next Event</p>
          <p className="text-[10px] font-black uppercase truncate">{nextEventStr}</p>
        </div>
      </div>
    </div>
  );
}
