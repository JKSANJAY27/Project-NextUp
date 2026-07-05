import React, { useState } from "react";
import api from "@/lib/api";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface ProjectSuggestion {
  title: string;
  description: string;
}

interface SuggestionsResult {
  optimized_summary?: string;
  optimized_skills?: string[];
  optimized_projects?: ProjectSuggestion[];
}

interface ReviewChangesProps {
  jobId: string;
  suggestions: SuggestionsResult;
  originalResume: {
    summary?: string;
    skills?: string[];
    projects?: Array<{ title: string; description: string }>;
  };
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ReviewChanges({
  jobId,
  suggestions,
  originalResume,
  onSuccess,
  onCancel
}: ReviewChangesProps) {
  const [acceptSummary, setAcceptSummary] = useState(true);
  const [acceptSkills, setAcceptSkills] = useState(true);
  const [acceptProjects, setAcceptProjects] = useState(true);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleApplyChanges = async () => {
    try {
      setApplying(true);
      setErrorMsg("");
      await api.post("/resumes/accept-changes", {
        job_id: jobId,
        accept_summary: acceptSummary,
        accept_skills: acceptSkills,
        accept_projects: acceptProjects
      });
      onSuccess();
    } catch (err: unknown) {
      console.error("Failed to apply resume changes:", err);
      const apiErr = err as { response?: { data?: { detail?: string } } };
      setErrorMsg(apiErr.response?.data?.detail || "Failed to apply changes to your master resume.");
      setApplying(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h3 className="text-sm font-bold tracking-wider uppercase text-muted-foreground mb-1">
          Review Optimization Suggestions
        </h3>
        <p className="text-xs text-muted-foreground">
          Compare the AI&apos;s proposed enhancements with your master resume. Select which updates you want to adopt and merge.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="space-y-6">
        {/* 1. Summary Comparison */}
        {suggestions.optimized_summary && (
          <div className="border border-border rounded-xl p-4 bg-card/25 space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="font-mono text-xs font-bold tracking-tight">Professional Summary</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptSummary}
                  onChange={(e) => setAcceptSummary(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent accent-accent h-4 w-4"
                />
                <span className="text-xs font-mono">Accept Modification</span>
              </label>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
              <div className="space-y-1">
                <span className="text-muted-foreground font-mono text-[10px]">CURRENT MASTER:</span>
                <p className="p-3 bg-muted/20 rounded border border-border/30 min-h-[60px] text-muted-foreground italic">
                  {originalResume.summary || "No summary provided in master resume."}
                </p>
              </div>
              <div className={`space-y-1 ${acceptSummary ? "opacity-100" : "opacity-50"}`}>
                <span className="text-accent font-mono text-[10px]">PROPOSED OPTIMIZATION:</span>
                <p className="p-3 bg-accent/5 rounded border border-accent/25 min-h-[60px] font-bold">
                  {suggestions.optimized_summary}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 2. Skills Comparison */}
        {suggestions.optimized_skills && suggestions.optimized_skills.length > 0 && (
          <div className="border border-border rounded-xl p-4 bg-card/25 space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="font-mono text-xs font-bold tracking-tight">Optimized Skills</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptSkills}
                  onChange={(e) => setAcceptSkills(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent accent-accent h-4 w-4"
                />
                <span className="text-xs font-mono">Accept Optimization</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
              <div className="space-y-1">
                <span className="text-muted-foreground text-[10px]">CURRENT MASTER:</span>
                <div className="p-3 bg-muted/20 rounded border border-border/30 flex flex-wrap gap-1.5 min-h-[60px] items-start">
                  {originalResume.skills && originalResume.skills.length > 0 ? (
                    originalResume.skills.map((s, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground italic">No skills listed.</span>
                  )}
                </div>
              </div>
              <div className={`space-y-1 ${acceptSkills ? "opacity-100" : "opacity-50"}`}>
                <span className="text-accent text-[10px]">PROPOSED SKILLS LIST:</span>
                <div className="p-3 bg-accent/5 rounded border border-accent/25 flex flex-wrap gap-1.5 min-h-[60px] items-start">
                  {suggestions.optimized_skills.map((s, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-accent/15 text-accent text-[10px] font-bold">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Projects Comparison */}
        {suggestions.optimized_projects && suggestions.optimized_projects.length > 0 && (
          <div className="border border-border rounded-xl p-4 bg-card/25 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="font-mono text-xs font-bold tracking-tight">Tailored Project Descriptions</span>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptProjects}
                  onChange={(e) => setAcceptProjects(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent accent-accent h-4 w-4"
                />
                <span className="text-xs font-mono">Accept Project Phrasing</span>
              </label>
            </div>

            <div className="space-y-4">
              {suggestions.optimized_projects.map((op, idx) => {
                const origProj = originalResume.projects?.find(
                  (p) => p.title.trim().toLowerCase() === op.title.trim().toLowerCase()
                );
                return (
                  <div key={idx} className="space-y-2 border-l-2 border-border pl-4">
                    <h4 className="text-xs font-mono font-bold tracking-tight text-foreground/80">
                      PROJECT // {op.title.toUpperCase()}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
                      <div className="space-y-1">
                        <span className="text-muted-foreground font-mono text-[9px]">CURRENT DESCRIPTION:</span>
                        <p className="p-2.5 bg-muted/15 rounded border border-border/20 text-muted-foreground italic">
                          {origProj?.description || "No project description listed."}
                        </p>
                      </div>
                      <div className={`space-y-1 ${acceptProjects ? "opacity-100" : "opacity-50"}`}>
                        <span className="text-accent font-mono text-[9px]">TAILORED IMPACT POINTS:</span>
                        <p className="p-2.5 bg-accent/5 rounded border border-accent/15 font-bold">
                          {op.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <button
          onClick={onCancel}
          disabled={applying}
          className="border border-border hover:border-muted-foreground text-foreground text-xs font-mono py-2.5 px-5 rounded-xl transition"
        >
          Discard Suggestions
        </button>
        <button
          onClick={handleApplyChanges}
          disabled={applying}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground text-xs font-mono py-2.5 px-5 rounded-xl font-bold shadow-md transition"
        >
          {applying ? (
            <>
              <Loader2 className="animate-spin h-3.5 w-3.5" />
              Merging and Rendering PDF...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Merge & Apply Selected changes
            </>
          )}
        </button>
      </div>
    </div>
  );
}
