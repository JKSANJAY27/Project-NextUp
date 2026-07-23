"use client";

import React, { useState, useMemo } from "react";
import api from "@/lib/api";
import { Loader2, CheckCircle2, AlertCircle, Plus, X, RotateCcw, Sparkles, HelpCircle } from "lucide-react";

interface ProjectSuggestion {
  title: string;
  description: string;
  ai_description?: string;
  _status?: "kept" | "reverted" | "near_copy" | "deterministic" | "unchanged";
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

function formatBulletText(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const bullets: string[] = [];
  for (const line of lines) {
    const parts = line.split(/\s*•\s*/).map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      const clean = p.startsWith("•") ? p.slice(1).trim() : p;
      bullets.push(`• ${clean}`);
    }
  }
  if (bullets.length === 0) return text;
  return bullets.join("\n");
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
  onCancel,
}: ReviewChangesProps) {
  // 1. Summary State
  const [summaryText, setSummaryText] = useState<string>(
    suggestions.optimized_summary || originalResume.summary || ""
  );

  // 2. Skills State
  const [skillsList, setSkillsList] = useState<string[]>(() => {
    if (suggestions.optimized_skills && suggestions.optimized_skills.length > 0) {
      return [...suggestions.optimized_skills];
    }
    return originalResume.skills ? [...originalResume.skills] : [];
  });
  const [newSkillInput, setNewSkillInput] = useState("");

  // Missing ATS keywords state (allows removing from missing when added to skills)
  const [missingKeywords, setMissingKeywords] = useState<string[]>(
    suggestions.ats_coverage?.missing || []
  );

  // 3. Projects State (map title -> current description text)
  const [projectTextMap, setProjectTextMap] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    const optProjs = suggestions.optimized_projects || [];
    optProjs.forEach((p) => {
      map[p.title.trim().toLowerCase()] = formatBulletText(p.description);
    });

    // Also seed any original projects that weren't in optimized_projects
    (originalResume.projects || []).forEach((p) => {
      const key = p.title.trim().toLowerCase();
      if (!(key in map)) {
        map[key] = formatBulletText(p.description);
      }
    });
    return map;
  });

  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Add skill helper
  const handleAddSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed) return;
    if (!skillsList.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setSkillsList((prev) => [...prev, trimmed]);
    }
    // If it was in missing keywords, remove from missing
    setMissingKeywords((prev) => prev.filter((k) => k.toLowerCase() !== trimmed.toLowerCase()));
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkillsList((prev) => prev.filter((s) => s !== skillToRemove));
  };

  const handleResetSkillsToMaster = () => {
    setSkillsList(originalResume.skills ? [...originalResume.skills] : []);
    setMissingKeywords(suggestions.ats_coverage?.missing || []);
  };

  const handleApplyChanges = async () => {
    try {
      setApplying(true);
      setErrorMsg("");

      // Construct project overrides title -> text map
      const projectOverrides: Record<string, string> = {};
      const allProjects = suggestions.optimized_projects || [];
      allProjects.forEach((p) => {
        const key = p.title.trim().toLowerCase();
        if (key in projectTextMap) {
          projectOverrides[p.title] = projectTextMap[key];
        }
      });
      // Also include any original projects user edited
      (originalResume.projects || []).forEach((p) => {
        const key = p.title.trim().toLowerCase();
        if (key in projectTextMap && !(p.title in projectOverrides)) {
          projectOverrides[p.title] = projectTextMap[key];
        }
      });

      const res = await api.post("/resumes/accept-changes", {
        job_id: jobId,
        final_summary: summaryText,
        final_skills: skillsList,
        project_overrides: projectOverrides,
      });

      onSuccess(res.data || {});
    } catch (err: unknown) {
      console.error("Failed to apply resume changes:", err);
      const apiErr = err as { response?: { data?: { detail?: string } } };
      setErrorMsg(apiErr.response?.data?.detail || "Failed to generate the tailored resume.");
      setApplying(false);
    }
  };

  // Compile list of projects to render
  const projectsToRender = useMemo(() => {
    const list: Array<{
      title: string;
      originalDesc: string;
      aiDesc: string;
      status: "kept" | "reverted" | "near_copy" | "deterministic" | "unchanged";
    }> = [];

    const processedKeys = new Set<string>();

    (suggestions.optimized_projects || []).forEach((op) => {
      const key = op.title.trim().toLowerCase();
      processedKeys.add(key);
      const origMatch = originalResume.projects?.find(
        (p) => p.title.trim().toLowerCase() === key
      );
      list.push({
        title: op.title,
        originalDesc: formatBulletText(origMatch?.description || op.description),
        aiDesc: formatBulletText(op.ai_description || op.description),
        status: op._status || "kept",
      });
    });

    // Add any missing master projects
    (originalResume.projects || []).forEach((mp) => {
      const key = mp.title.trim().toLowerCase();
      if (!processedKeys.has(key)) {
        processedKeys.add(key);
        list.push({
          title: mp.title,
          originalDesc: formatBulletText(mp.description),
          aiDesc: formatBulletText(mp.description),
          status: "unchanged",
        });
      }
    });

    return list;
  }, [suggestions.optimized_projects, originalResume.projects]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <div>
        <h3 className="text-sm font-bold tracking-wider uppercase text-foreground mb-1 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          Review &amp; Edit Tailored Resume
        </h3>
        <p className="text-xs text-muted-foreground">
          Compare the proposed enhancements with your master resume. Edit any text directly, add or remove skills, and refine project bullet points before rendering your PDF. Your master resume is never modified.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-destructive text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Overview Notice */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-accent/30 bg-accent/5 text-foreground text-xs leading-relaxed">
        <Sparkles className="h-4 w-4 shrink-0 text-accent mt-0.5" />
        <div>
          <span className="font-bold text-accent uppercase tracking-wider block mb-0.5">
            Tailoring Complete
          </span>
          <p className="text-[11px] text-muted-foreground">
            The AI re-ordered your skills by JD relevance, aligned your summary, and generated tailored project descriptions. All proposed texts are pre-filled in the editable textareas on the right — review and edit as desired.
          </p>
        </div>
      </div>

      {/* Analytics Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {suggestions.readability && (
          <div className="border border-border rounded-xl p-4 bg-card/25 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold tracking-tight">Human Readability Score</span>
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

        {suggestions.ats_coverage && suggestions.ats_coverage.coverage_pct !== null && (
          <div className="border border-border rounded-xl p-4 bg-card/25 space-y-2">
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
              <div className="pt-1">
                <span className="text-[10px] font-mono text-muted-foreground uppercase mr-2">Matched JD keywords:</span>
                <span className="text-[10px] font-mono text-emerald-500">
                  {suggestions.ats_coverage.matched.slice(0, 6).join(", ")}
                  {suggestions.ats_coverage.matched.length > 6 && ` +${suggestions.ats_coverage.matched.length - 6} more`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* 1. PROFESSIONAL SUMMARY COMPARISON & EDITOR */}
        <div className="border border-border rounded-xl p-4 bg-card/25 space-y-3">
          <div className="flex flex-wrap justify-between items-center pb-2 border-b border-border/50 gap-2">
            <span className="font-mono text-xs font-bold tracking-tight uppercase flex items-center gap-2">
              1. Professional Summary
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
            {/* Left: Master Summary Reference */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-mono text-[9px] uppercase">
                  MASTER RESUME SUMMARY (REFERENCE):
                </span>
                {originalResume.summary && (
                  <button
                    type="button"
                    onClick={() => setSummaryText(originalResume.summary!)}
                    className="text-[10px] font-mono text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1"
                  >
                    <RotateCcw size={11} /> Use Master Summary
                  </button>
                )}
              </div>
              <div className="p-3 bg-muted/15 rounded-lg border border-border/20 text-muted-foreground italic font-sans min-h-[110px] whitespace-pre-wrap select-text">
                {originalResume.summary || "No summary provided in master resume."}
              </div>
            </div>

            {/* Right: Editable Tailored Summary */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-accent font-mono text-[9px] uppercase">
                  TAILORED SUMMARY (EDITABLE):
                </span>
                {suggestions.optimized_summary && (
                  <button
                    type="button"
                    onClick={() => setSummaryText(suggestions.optimized_summary!)}
                    className="text-[10px] font-mono text-accent hover:underline flex items-center gap-1"
                  >
                    <Sparkles size={11} /> Use AI Summary
                  </button>
                )}
              </div>
              <textarea
                value={summaryText}
                onChange={(e) => setSummaryText(e.target.value)}
                rows={4}
                className="w-full p-3 bg-card border border-accent/40 rounded-lg text-xs leading-relaxed text-foreground font-sans focus:outline-none focus:ring-1 focus:ring-accent min-h-[110px]"
                placeholder="Enter your professional summary..."
              />
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground pt-0.5">
                <span>Tip: Keep to 2-3 sentences (~400-600 chars) for optimal ATS ranking.</span>
                <span>{summaryText.length} chars</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. SKILLS CHIP EDITOR */}
        <div className="border border-border rounded-xl p-4 bg-card/25 space-y-4">
          <div className="flex flex-wrap justify-between items-center pb-2 border-b border-border/50 gap-2">
            <span className="font-mono text-xs font-bold tracking-tight uppercase flex items-center gap-2">
              2. Skills &amp; Competencies
              <span className="text-[10px] text-muted-foreground font-normal lowercase">(interactive chip editor)</span>
            </span>
            <button
              type="button"
              onClick={handleResetSkillsToMaster}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1"
            >
              <RotateCcw size={11} /> Reset to Master
            </button>
          </div>

          {/* Current Skills Chips */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono text-muted-foreground uppercase">CURRENT RESUME SKILLS ({skillsList.length}):</span>
            <div className="p-3 bg-card/50 rounded-lg border border-border/50 flex flex-wrap gap-1.5 min-h-[50px] items-center">
              {skillsList.length > 0 ? (
                skillsList.map((skill, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-accent/15 border border-accent/30 text-foreground text-[11px] font-mono font-medium group"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => handleRemoveSkill(skill)}
                      className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                      title={`Remove ${skill}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground italic font-mono">No skills added. Use the input below or click missing keywords to add skills.</span>
              )}
            </div>
          </div>

          {/* Add custom skill input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newSkillInput}
              onChange={(e) => setNewSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddSkill(newSkillInput);
                  setNewSkillInput("");
                }
              }}
              placeholder="Type a skill and press Enter..."
              className="flex-1 px-3 py-1.5 bg-card border border-border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => {
                handleAddSkill(newSkillInput);
                setNewSkillInput("");
              }}
              className="px-3 py-1.5 bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent text-xs font-mono font-bold rounded-lg flex items-center gap-1 transition-all"
            >
              <Plus size={13} /> Add
            </button>
          </div>

          {/* Missing ATS Keywords section — Click to add! */}
          {missingKeywords.length > 0 && (
            <div className="p-3 bg-muted/20 border border-border/40 rounded-lg space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground uppercase font-bold">
                <HelpCircle size={12} className="text-amber-500" />
                STILL NOT COVERED — CLICK ANY KEYWORD TO ADD IT TO YOUR RESUME SKILLS:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {missingKeywords.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => handleAddSkill(kw)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-card hover:bg-accent/20 hover:border-accent hover:text-accent text-[10px] font-mono text-muted-foreground transition-all active:scale-95"
                    title={`Click to add ${kw} to your skills`}
                  >
                    <Plus size={10} className="text-accent" />
                    {kw}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3. TAILORED PROJECT DESCRIPTIONS COMPARISON & EDITOR */}
        <div className="border border-border rounded-xl p-4 bg-card/25 space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-border/50">
            <span className="font-mono text-xs font-bold tracking-tight uppercase flex items-center gap-2">
              3. Project Descriptions
            </span>
          </div>

          <div className="space-y-6 divide-y divide-border/40">
            {projectsToRender.map((proj, idx) => {
              const currentText = projectTextMap[proj.title.trim().toLowerCase()] ?? proj.originalDesc;

              return (
                <div key={proj.title} className={`${idx > 0 ? "pt-6" : ""} space-y-3`}>
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-mono font-bold tracking-tight text-foreground uppercase">
                        PROJECT // {proj.title}
                      </h4>
                      {/* Status Badges */}
                      {proj.status === "kept" && (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-[9px] font-mono font-bold flex items-center gap-1">
                          <Sparkles size={9} /> ✨ AI Tailored
                        </span>
                      )}
                      {proj.status === "reverted" && (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[9px] font-mono font-bold flex items-center gap-1">
                          <AlertCircle size={9} /> ⚠ AI Metric Adjusted
                        </span>
                      )}
                      {proj.status === "near_copy" && (
                        <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[9px] font-mono font-bold">
                          ≈ Near Match
                        </span>
                      )}
                      {proj.status === "unchanged" && (
                        <span className="px-2 py-0.5 rounded bg-muted/40 border border-border text-muted-foreground text-[9px] font-mono">
                          ○ Original Wording
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-mono">
                      {proj.aiDesc && (
                        <button
                          type="button"
                          onClick={() => {
                            setProjectTextMap((prev) => ({
                              ...prev,
                              [proj.title.trim().toLowerCase()]: proj.aiDesc,
                            }));
                          }}
                          className="text-accent hover:underline flex items-center gap-1"
                        >
                          <Sparkles size={10} /> Use AI Wording
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setProjectTextMap((prev) => ({
                            ...prev,
                            [proj.title.trim().toLowerCase()]: proj.originalDesc,
                          }));
                        }}
                        className="text-muted-foreground hover:text-foreground hover:underline flex items-center gap-1"
                      >
                        <RotateCcw size={10} /> Use Original
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
                    {/* Left: Master Reference */}
                    <div className="space-y-1">
                      <span className="text-muted-foreground font-mono text-[9px] uppercase">
                        MASTER RESUME DESCRIPTION (REFERENCE):
                      </span>
                      <div className="p-3 bg-muted/15 rounded-lg border border-border/20 text-muted-foreground italic font-sans min-h-[140px] whitespace-pre-wrap select-text leading-relaxed">
                        {proj.originalDesc || "No original description."}
                      </div>
                    </div>

                    {/* Right: Editable Tailored Textarea */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-accent font-mono text-[9px] uppercase">
                        <span>TAILORED DESCRIPTION (EDITABLE):</span>
                        <span>{currentText.length} chars</span>
                      </div>
                      <textarea
                        value={currentText}
                        onChange={(e) => {
                          const val = e.target.value;
                          setProjectTextMap((prev) => ({
                            ...prev,
                            [proj.title.trim().toLowerCase()]: val,
                          }));
                        }}
                        rows={6}
                        className="w-full p-3 bg-card border border-accent/40 rounded-lg text-xs leading-relaxed text-foreground font-sans focus:outline-none focus:ring-1 focus:ring-accent min-h-[140px] resize-y"
                        placeholder="• Bullet 1&#10;• Bullet 2"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex flex-wrap justify-between items-center gap-4 pt-4 border-t border-border sticky bottom-0 bg-background/95 backdrop-blur py-3 px-2 z-20">
        <button
          onClick={onCancel}
          disabled={applying}
          className="border border-border hover:border-muted-foreground text-foreground text-xs font-mono py-2.5 px-5 rounded-xl transition"
        >
          Discard Changes
        </button>

        <button
          onClick={handleApplyChanges}
          disabled={applying}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-black text-xs font-mono py-2.5 px-6 rounded-xl font-black shadow-lg transition active:scale-95"
        >
          {applying ? (
            <>
              <Loader2 className="animate-spin h-4 w-4" />
              Rendering PDF with Custom Edits...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Merge &amp; Generate Tailored PDF
            </>
          )}
        </button>
      </div>
    </div>
  );
}
