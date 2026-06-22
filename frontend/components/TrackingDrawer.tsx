import React from "react";
import { Company, Application, CompanyEvent } from "@/app/tracking/types";
import { X, Calendar, Edit2, Archive, StickyNote, FileText, MapPin } from "lucide-react";

interface TrackingDrawerProps {
  company: Company | null;
  application: Application | null;
  nextEvent: CompanyEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onMoveStage: (newStage: string) => void;
}

const STAGES = ["Applied", "Registration", "Shortlisted", "OA", "Interview", "Offer"];

export default function TrackingDrawer({
  company,
  application,
  nextEvent,
  isOpen,
  onClose,
  onMoveStage
}: TrackingDrawerProps) {
  if (!isOpen || !company || !application) return null;

  // Determine current stage index for timeline
  // Using normalized logic
  let currentStageIndex = 0;
  const status = application.status || "Applied";
  
  if (status.includes("Offer")) currentStageIndex = 5;
  else if (status.includes("Interview") || status === "Technical" || status === "HR") currentStageIndex = 4;
  else if (status === "OA" || status.includes("Assessment")) currentStageIndex = 3;
  else if (status === "Shortlisted") currentStageIndex = 2;
  else if (status === "Registration") currentStageIndex = 1;
  else currentStageIndex = 0; // Applied

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full md:w-[450px] border-l-2 border-border bg-background shadow-2xl animate-in slide-in-from-right-full duration-300 flex flex-col h-full">
        
        {/* Header */}
        <div className="border-b-2 border-border p-6 relative bg-muted/10">
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 border border-border p-2 bg-card hover:bg-accent hover:text-black transition-all"
          >
            <X size={16} />
          </button>
          
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-background border border-border text-foreground">
            {company.category}
          </span>
          <h2 className="text-2xl font-black uppercase tracking-tighter mt-4 leading-none">
            {company.name}
          </h2>
          <p className="text-sm text-muted-foreground uppercase font-bold mt-1">
            {company.role}
          </p>
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border/50">
            <div>
              <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Package</p>
              <p className="text-sm font-mono font-bold uppercase">{company.ctc || company.stipend || "TBD"}</p>
            </div>
            {company.job_location && (
              <div>
                <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Location</p>
                <p className="text-sm font-bold uppercase flex items-center gap-1">
                  <MapPin size={12} className="text-muted-foreground" />
                  {company.job_location}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Content Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Timeline */}
          <div className="space-y-4">
            <h3 className="text-xs font-black tracking-widest uppercase border-b border-border pb-2">
              Timeline Progression
            </h3>
            <div className="space-y-3 pl-2">
              {STAGES.map((s, idx) => {
                const isPast = idx < currentStageIndex;
                const isCurrent = idx === currentStageIndex;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isPast ? "bg-accent border-accent text-black" : 
                      isCurrent ? "bg-background border-accent" : 
                      "bg-background border-border"
                    }`}>
                      {isPast && <span className="text-[10px] font-black leading-none">✓</span>}
                      {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                    </div>
                    <span className={`text-xs font-bold uppercase ${
                      isPast ? "text-muted-foreground" : 
                      isCurrent ? "text-foreground font-black" : 
                      "text-muted-foreground opacity-50"
                    }`}>
                      {s}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Upcoming Event */}
          <div className="space-y-4">
            <h3 className="text-xs font-black tracking-widest uppercase border-b border-border pb-2">
              Next Upcoming Event
            </h3>
            {nextEvent ? (
              <div className="border-2 border-accent/50 bg-accent/5 p-4 space-y-2">
                <h4 className="font-bold uppercase text-accent tracking-tight">{nextEvent.event_type}</h4>
                {nextEvent.timestamp && (
                  <div className="flex items-center gap-2 text-xs font-mono font-bold">
                    <Calendar size={14} className="text-muted-foreground" />
                    <span>{new Date(nextEvent.timestamp).toLocaleDateString("en-GB", { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span>•</span>
                    <span>{new Date(nextEvent.timestamp).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}
                {nextEvent.body && (
                  <p className="text-[10px] text-muted-foreground mt-2 line-clamp-3">
                    {nextEvent.body}
                  </p>
                )}
              </div>
            ) : (
              <div className="border border-dashed border-border p-4 text-center text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                No upcoming events scheduled
              </div>
            )}
          </div>

          {/* Manual Movement */}
          <div className="space-y-4">
            <h3 className="text-xs font-black tracking-widest uppercase border-b border-border pb-2">
              Manual Movement Fallback
            </h3>
            <p className="text-[9px] text-muted-foreground uppercase leading-relaxed">
              Use these actions only if email parsing fails to automatically progress the application.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onMoveStage("Registration")} className="h-8 border border-border text-[9px] font-bold hover:bg-yellow-500 hover:text-black uppercase transition-colors">Move to Registration</button>
              <button onClick={() => onMoveStage("Shortlisted")} className="h-8 border border-border text-[9px] font-bold hover:bg-blue-500 hover:text-black uppercase transition-colors">Move to Shortlisted</button>
              <button onClick={() => onMoveStage("OA")} className="h-8 border border-border text-[9px] font-bold hover:bg-orange-500 hover:text-black uppercase transition-colors">Move to OA</button>
              <button onClick={() => onMoveStage("Interview")} className="h-8 border border-border text-[9px] font-bold hover:bg-purple-500 hover:text-black uppercase transition-colors">Move to Interview</button>
              <button onClick={() => onMoveStage("Offer")} className="h-8 border border-border text-[9px] font-bold hover:bg-emerald-500 hover:text-black uppercase transition-colors">Move to Offer</button>
              <button onClick={() => onMoveStage("Rejected")} className="h-8 border border-border text-[9px] font-bold hover:bg-red-500 hover:text-white hover:border-red-500 uppercase transition-colors">Reject</button>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="border-t-2 border-border p-6 bg-muted/10">
          <div className="grid grid-cols-3 gap-3">
            <button className="flex flex-col items-center justify-center gap-1 border border-border p-2 bg-card hover:bg-muted transition-colors">
              <Edit2 size={16} />
              <span className="text-[9px] font-bold uppercase tracking-wider">Edit</span>
            </button>
            <button className="flex flex-col items-center justify-center gap-1 border border-border p-2 bg-card hover:bg-muted transition-colors">
              <Calendar size={16} />
              <span className="text-[9px] font-bold uppercase tracking-wider">Calendar</span>
            </button>
            <button className="flex flex-col items-center justify-center gap-1 border border-border p-2 bg-card hover:bg-muted transition-colors">
              <StickyNote size={16} />
              <span className="text-[9px] font-bold uppercase tracking-wider">Notes</span>
            </button>
            <button className="flex flex-col items-center justify-center gap-1 border border-border p-2 bg-card hover:bg-muted transition-colors">
              <FileText size={16} />
              <span className="text-[9px] font-bold uppercase tracking-wider">Resume</span>
            </button>
            <button onClick={() => onMoveStage("Archive")} className="col-span-2 flex items-center justify-center gap-2 border-2 border-border p-2 bg-background hover:bg-red-950 hover:text-red-400 hover:border-red-500 transition-colors">
              <Archive size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Archive Workspace</span>
            </button>
          </div>
        </div>

      </div>
    </>
  );
}
