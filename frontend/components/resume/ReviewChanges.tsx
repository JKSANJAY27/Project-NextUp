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
  tailoring_mode?: string;
  tailoring_note?: string;
  quality_note?: string;
  ats_coverage?: {
    matched: string[];
    missing: string[];
    coverage_pct: number | null;
  };
  readability?: {
    score: number;
    issues: string[];
  };
}

function scoreColor(v: number): string {
  return v >= 70 ? "text-emerald-500" : v >= 40 ? "text-amber-500" : "text-destructive";
}
function scoreBar(v: number): string {
  return v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-500" : "bg-destructive";
}

interface ReviewChangesProps {
  jobId: string;
  suggestions: SuggestionsResult;
  originalResume: {
    summary?: string;
    skills?: string[];
    projects?: Array<{ title: string; description: string }>;
  };
  onSuccess: (result: { pdf_base64?: string; pdf_filename?: string }) => void;
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
      const res = await api.post("/resumes/accept-changes", {
        job_id: jobId,
        accept_summary: acceptSummary,
        accept_skills: acceptSkills,
        accept_projects: acceptProjects
      });
      onSuccess(res.data || {});
    } catch (err: unknown) {
      console.error("Failed to apply resume changes:", err);
      const apiErr = err as { response?: { data?: { detail?: string } } };
      setErrorMsg(apiErr.response?.data?.detail || "Failed to generate the tailored resume.");
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
          Compare the AI&apos;s proposed enhancements with your master resume. Accepted changes go into a
          company-specific copy — your master resume is never modified.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {(suggestions.tailoring_mode === "deterministic" || suggestions.tailoring_note) && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-500 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {suggestions.tailoring_note ||
              "AI providers were unavailable — your skills and projects were re-ordered to match the JD keywords instead. All wording is your own."}
          </span>
        </div>
      )}

      {suggestions.quality_note && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/10 text-muted-foreground text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{suggestions.quality_note}</span>
        </div>
      )}

      {/* Two separate scores by design: keyword-stuffing can raise ATS while
          hurting readability, and prettier wording can drop keywords. */}
      {suggestions.readability && (
        <div className="border border-border rounded-xl p-4 bg-card/25 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold tracking-tight">Human Readability</span>
            <span className={`font-mono text-sm font-black ${scoreColor(suggestions.readability.score)}`}>
              {suggestions.readability.score}%
            </span>
          </div>
          <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${scoreBar(suggestions.readability.score)}`}
              style={{ width: `${suggestions.readability.score}%` }}
            />
          </div>
          {suggestions.readability.issues.length > 0 && (
            <ul className="text-[10px] font-mono text-muted-foreground space-y-0.5 pt-1">
              {suggestions.readability.issues.map((iss) => (
                <li key={iss}>⚠ {iss}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ATS keyword coverage — what the tailored resume hits vs. genuinely lacks */}
      {suggestions.ats_coverage && suggestions.ats_coverage.coverage_pct !== null && (
        <div className="border border-border rounded-xl p-4 bg-card/25 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold tracking-tight">ATS Keyword Coverage</span>
            <span className={`font-mono text-sm font-black ${scoreColor(suggestions.ats_coverage.coverage_pct)}`}>
              {suggestions.ats_coverage.coverage_pct}%
            </span>
          </div>
          <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${scoreBar(suggestions.ats_coverage.coverage_pct)}`}
              style={{ width: `${suggestions.ats_coverage.coverage_pct}%` }}
            />
          </div>
          {suggestions.ats_coverage.matched.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Matched JD keywords</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.ats_coverage.matched.map((k) => (
                  <span key={k} className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 text-emerald-500">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
          {suggestions.ats_coverage.missing.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">
                Still not covered — the AI could not tie these to your real experience (never faked)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.ats_coverage.missing.map((k) => (
                  <span key={k} className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border bg-muted/20 text-muted-foreground">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
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
