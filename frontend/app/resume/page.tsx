"use client";

import React, { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import ResumeTemplateSelector from "@/components/resume/ResumeTemplateSelector";
import ResumeGenerationProgress from "@/components/resume/ResumeGenerationProgress";
import ReviewChanges from "@/components/resume/ReviewChanges";
import {
  FileText,
  Upload,
  Sparkles,
  Building2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Download
} from "lucide-react";
import { useAppStore } from "@/lib/store";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Company {
  id: string;
  name: string;
  role: string;
  ctc: string | null;
}

interface ResumeData {
  summary?: string;
  skills?: string[];
  projects?: Array<{ title: string; description: string }>;
  personal?: { name: string; email: string };
  education?: Record<string, unknown>[];
  experience?: Record<string, unknown>[];
}

type PageView = "configure" | "progress" | "review" | "done";

// ─── Component ───────────────────────────────────────────────────────────────

export default function ResumePage() {
  const encryptionKey = useAppStore((state) => state.encryptionKey);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Saved resume state
  const [savedResume, setSavedResume] = useState<ResumeData | null>(null);
  const [currentTemplate, setCurrentTemplate] = useState<string>("Classic");
  const [hasSavedResume, setHasSavedResume] = useState(false);
  const [loadingResume, setLoadingResume] = useState(true);
  const [resumeError, setResumeError] = useState("");

  // Company selection
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [customPrompt, setCustomPrompt] = useState("");

  // File upload
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Generation flow
  const [view, setView] = useState<PageView>("configure");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<Record<string, unknown> | null>(null);
  const [startingJob, setStartingJob] = useState(false);
  const [startError, setStartError] = useState("");

  // ─── Loaders ─────────────────────────────────────────────────────────────

  const loadResume = useCallback(async () => {
    try {
      setLoadingResume(true);
      setResumeError("");
      const res = await api.get("/resumes/me");
      const data = res.data;
      setSavedResume(data.resume_data || null);
      setCurrentTemplate(data.template || "Classic");
      setHasSavedResume(!!data.resume_data);
    } catch (err: unknown) {
      const apiErr = err as { response?: { status?: number } };
      if (apiErr.response?.status !== 404) {
        setResumeError("Could not load master resume. Please ensure you are logged in.");
      }
      setHasSavedResume(false);
    } finally {
      setLoadingResume(false);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    try {
      setLoadingCompanies(true);
      const res = await api.get("/companies");
      const list: Company[] = (res.data || []).filter((c: { archived?: boolean }) => !c.archived);
      setCompanies(list);
      if (list.length > 0 && !selectedCompanyId) {
        setSelectedCompanyId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load companies:", err);
    } finally {
      setLoadingCompanies(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadResume();
    loadCompanies();
  }, [loadResume, loadCompanies]);

  // ─── PDF Upload ───────────────────────────────────────────────────────────

  const handleUploadPDF = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadMsg({ type: "error", text: "Only PDF files are accepted." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadMsg({ type: "error", text: "File exceeds the 5MB maximum size limit." });
      return;
    }

    setUploading(true);
    setUploadMsg(null);

    try {
      // Step 1: Parse PDF to structured JSON
      const formData = new FormData();
      formData.append("file", file);
      const parseRes = await api.post("/resumes/parse", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      const parsed = parseRes.data;

      // Step 2: Save the parsed data to master resume
      await api.put("/resumes/me", {
        template: currentTemplate,
        resume_data: parsed
      });

      setUploadMsg({
        type: "success",
        text: "Resume parsed and saved as your master profile. The AI will tailor this for each company."
      });
      await loadResume();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      const msg = apiErr.response?.data?.detail || "Failed to process your resume. Please try again.";
      setUploadMsg({ type: "error", text: msg });
    } finally {
      setUploading(false);
    }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUploadPDF(file);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUploadPDF(file);
    e.target.value = "";
  };

  // ─── Template Save ────────────────────────────────────────────────────────

  const handleSaveTemplate = async (templateId: string) => {
    setCurrentTemplate(templateId);
    if (savedResume) {
      try {
        await api.put("/resumes/me", {
          template: templateId,
          resume_data: savedResume
        });
      } catch (err) {
        console.error("Failed to persist template choice:", err);
      }
    }
  };

  // ─── Start Generation Job ─────────────────────────────────────────────────

  const handleStartGeneration = async () => {
    if (!selectedCompanyId) {
      setStartError("Please select a target company drive first.");
      return;
    }
    if (!hasSavedResume) {
      setStartError("Upload your master resume before tailoring.");
      return;
    }

    setStartError("");
    setStartingJob(true);

    try {
      const res = await api.post("/resumes/generate", {
        company_id: selectedCompanyId,
        latex_template: currentTemplate,
        custom_prompt: customPrompt.trim() || undefined
      });
      setActiveJobId(res.data.job_id);
      setView("progress");
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      const msg = apiErr.response?.data?.detail || "Failed to queue resume generation job.";
      setStartError(msg);
    } finally {
      setStartingJob(false);
    }
  };

  // ─── Job Completion Handlers ──────────────────────────────────────────────

  const handleJobComplete = (result: Record<string, unknown>) => {
    setJobResult(result);
    setView("review");
  };

  const handleCancelOrGoBack = () => {
    setActiveJobId(null);
    setJobResult(null);
    setView("configure");
  };

  const handleDownloadPDF = async () => {
    if (!encryptionKey) {
      alert("Encryption key missing. Please log in again to unlock your Vault.");
      return;
    }
    setDownloadingPdf(true);
    try {
      const res = await api.get("/resumes/me");
      const { pdf_file_enc, pdf_filename_enc } = res.data;
      if (!pdf_file_enc) {
        alert("No compiled PDF found. Try re-saving your resume.");
        setDownloadingPdf(false);
        return;
      }
      
      const { decryptData } = await import("@/lib/crypto");
      const decryptedBase64 = await decryptData(pdf_file_enc, encryptionKey);
      const filename = pdf_filename_enc ? await decryptData(pdf_filename_enc, encryptionKey) : "tailored_resume.pdf";
      
      // Convert base64 string to Blob
      const byteCharacters = atob(decryptedBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to download PDF:", err);
      alert("Failed to decrypt and download compiled PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleChangesAccepted = () => {
    setView("done");
  };

  // ─── Selected Company ─────────────────────────────────────────────────────

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (view === "progress" && activeJobId) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        <div className="max-w-2xl mx-auto px-4 pt-20">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-mono font-bold tracking-tighter">
              RESUME TAILORING
            </h1>
            {selectedCompany && (
              <p className="text-xs text-muted-foreground mt-1">
                Targeting{" "}
                <span className="text-accent font-bold">{selectedCompany.name}</span>
                {selectedCompany.role ? ` — ${selectedCompany.role}` : ""}
              </p>
            )}
          </div>
          <div className="border border-border rounded-2xl bg-card/30 backdrop-blur p-6">
            <ResumeGenerationProgress
              jobId={activeJobId}
              onComplete={handleJobComplete}
              onCancel={handleCancelOrGoBack}
            />
          </div>
        </div>
      </div>
    );
  }

  if (view === "review" && jobResult && activeJobId) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans">
        <div className="max-w-5xl mx-auto px-4 pt-16 pb-10">
          <div className="mb-8">
            <h1 className="text-2xl font-mono font-bold tracking-tighter">
              REVIEW OPTIMIZATIONS
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Accept or discard each AI suggestion before merging into your master resume.
            </p>
          </div>
          <div className="border border-border rounded-2xl bg-card/30 backdrop-blur p-6">
            <ReviewChanges
              jobId={activeJobId}
              suggestions={jobResult}
              originalResume={savedResume || {}}
              onSuccess={handleChangesAccepted}
              onCancel={handleCancelOrGoBack}
            />
          </div>
        </div>
      </div>
    );
  }

  if (view === "done") {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4 space-y-6">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-accent/20 rounded-full blur-2xl" />
            <div className="relative w-20 h-20 rounded-full border-2 border-accent flex items-center justify-center bg-card mx-auto">
              <CheckCircle2 className="h-10 w-10 text-accent" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-mono font-bold tracking-tighter">
              RESUME UPDATED
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your master resume has been merged with the accepted AI suggestions and compiled to PDF.
              The updated version is securely stored in your vault.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleDownloadPDF}
              disabled={downloadingPdf}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-accent-foreground text-xs font-mono py-2.5 px-5 rounded-xl font-bold shadow-md transition disabled:opacity-50"
            >
              {downloadingPdf ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5" />
                  Decrypting...
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Download compiled PDF
                </>
              )}
            </button>
            <button
              onClick={() => {
                setView("configure");
                setJobResult(null);
                setActiveJobId(null);
                loadResume();
              }}
              className="flex items-center gap-2 border border-border hover:border-accent text-foreground text-xs font-mono py-2.5 px-5 rounded-xl transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tailor for Another Company
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main "configure" view ──
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="max-w-5xl mx-auto px-4 pt-14 pb-20 space-y-10">

        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-mono font-black tracking-tighter">
            AI RESUME TAILORING
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
            Upload your master resume once. The AI will tailor your summary, skills, and project descriptions
            specifically for each company&apos;s JD strategy — with zero hallucinations.
          </p>
        </div>

        {/* Global errors */}
        {resumeError && (
          <div className="flex items-center gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{resumeError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">

          {/* ── LEFT COLUMN: Upload + Template ─────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Master Resume Upload */}
            <div className="border border-border rounded-2xl bg-card/30 backdrop-blur p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <FileText className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-mono font-bold tracking-tight">Master Resume</h2>
                {hasSavedResume && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-500 font-mono border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Vault Synced
                  </span>
                )}
              </div>

              {loadingResume ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground">
                  <Loader2 className="animate-spin h-5 w-5" />
                </div>
              ) : (
                <label
                  htmlFor="resume-upload"
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  className={`relative flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                    dragOver
                      ? "border-accent bg-accent/10 scale-[1.01]"
                      : hasSavedResume
                      ? "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/60"
                      : "border-border hover:border-accent/50 hover:bg-card/60"
                  }`}
                >
                  <input
                    id="resume-upload"
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileInput}
                  />
                  {uploading ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Loader2 className="animate-spin h-7 w-7 text-accent" />
                      <p className="text-xs text-muted-foreground font-mono">
                        Parsing and encrypting...
                      </p>
                    </div>
                  ) : hasSavedResume ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                      <div>
                        <p className="text-xs font-mono font-bold text-emerald-500">
                          Resume on file
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Drop a new PDF to replace
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Upload className="h-7 w-7 text-muted-foreground group-hover:text-accent transition" />
                      <div>
                        <p className="text-xs font-mono font-bold">Drop PDF here</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          or click to browse (max 5MB)
                        </p>
                      </div>
                    </div>
                  )}
                </label>
              )}

              {uploadMsg && (
                <div
                  className={`flex items-start gap-2 p-3 rounded-lg border text-[11px] leading-relaxed ${
                    uploadMsg.type === "success"
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-500"
                      : "border-destructive/20 bg-destructive/5 text-destructive"
                  }`}
                >
                  {uploadMsg.type === "success" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  )}
                  <span>{uploadMsg.text}</span>
                </div>
              )}

              {/* Parsed resume quick preview */}
              {hasSavedResume && savedResume && (
                <div className="text-[10px] font-mono text-muted-foreground space-y-1 pt-1 border-t border-border/50">
                  {savedResume.personal?.name && (
                    <p>👤 <span className="text-foreground">{savedResume.personal.name}</span></p>
                  )}
                  {savedResume.skills && savedResume.skills.length > 0 && (
                    <p>🛠 <span className="text-foreground">{savedResume.skills.slice(0, 5).join(", ")}{savedResume.skills.length > 5 ? ` +${savedResume.skills.length - 5} more` : ""}</span></p>
                  )}
                  {savedResume.projects && (
                    <p>📁 <span className="text-foreground">{savedResume.projects.length} projects</span></p>
                  )}
                </div>
              )}
            </div>

            {/* Template Selector */}
            <div className="border border-border rounded-2xl bg-card/30 backdrop-blur p-5">
              <ResumeTemplateSelector
                selectedTemplate={currentTemplate}
                onSelectTemplate={handleSaveTemplate}
              />
            </div>
          </div>

          {/* ── RIGHT COLUMN: Company Selection + Tailoring ─────────── */}
          <div className="lg:col-span-3 space-y-6">

            {/* Target Company */}
            <div className="border border-border rounded-2xl bg-card/30 backdrop-blur p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <Building2 className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-mono font-bold tracking-tight">Target Drive</h2>
              </div>

              {loadingCompanies ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="animate-spin h-4 w-4" />
                  Loading company drives...
                </div>
              ) : companies.length === 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <AlertCircle className="h-4 w-4" />
                  No active company drives found. New drives are auto-discovered from placement emails.
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                    className="w-full appearance-none bg-muted/20 border border-border rounded-xl px-4 py-3 pr-10 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent transition"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.role ? ` — ${c.role}` : ""}
                        {c.ctc ? ` (${c.ctc})` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              )}

              {selectedCompany && (
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  {selectedCompany.role && (
                    <div className="bg-muted/10 border border-border/30 rounded-lg p-2.5">
                      <p className="text-muted-foreground mb-0.5">ROLE</p>
                      <p className="text-foreground font-bold truncate">{selectedCompany.role}</p>
                    </div>
                  )}
                  {selectedCompany.ctc && (
                    <div className="bg-muted/10 border border-border/30 rounded-lg p-2.5">
                      <p className="text-muted-foreground mb-0.5">CTC</p>
                      <p className="text-foreground font-bold">{selectedCompany.ctc}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Custom Prompt (Optional) */}
            <div className="border border-border rounded-2xl bg-card/30 backdrop-blur p-5 space-y-3">
              <div>
                <h2 className="text-sm font-mono font-bold tracking-tight">
                  Custom Instructions{" "}
                  <span className="text-muted-foreground font-normal text-xs">— optional</span>
                </h2>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Additional guidance for the AI. e.g. &quot;Emphasize my ML projects&quot; or &quot;Keep it under 1 page.&quot;
                </p>
              </div>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="E.g. Focus on backend development experience and minimize design work..."
                rows={3}
                maxLength={500}
                className="w-full resize-none bg-muted/10 border border-border rounded-xl px-4 py-3 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent transition"
              />
              <p className="text-[10px] text-muted-foreground text-right">
                {customPrompt.length}/500
              </p>
            </div>

            {/* What the AI will do */}
            <div className="border border-border/50 rounded-2xl bg-card/10 p-5 space-y-3">
              <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-muted-foreground">
                What the AI Optimizes
              </h3>
              <div className="space-y-2">
                {[
                  { icon: "📝", title: "Professional Summary", desc: "Rewrites your opening to match JD tone and priority keywords" },
                  { icon: "🛠", title: "Skills Ordering", desc: "Re-ranks and filters skills to front-load JD-matched technologies" },
                  { icon: "📁", title: "Project Descriptions", desc: "Rephrases impact bullets using JD's preferred terminology" }
                ].map((item) => (
                  <div key={item.title} className="flex gap-3 text-xs">
                    <span className="text-base leading-none mt-0.5">{item.icon}</span>
                    <div>
                      <p className="font-mono font-bold">{item.title}</p>
                      <p className="text-muted-foreground text-[10px] mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 border-t border-border/30 pt-3">
                ⚠ All AI suggestions are verified against your actual resume data. Hallucinated facts are automatically rejected.
              </p>
            </div>

            {/* Errors */}
            {startError && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{startError}</span>
              </div>
            )}

            {/* Generate CTA */}
            <button
              onClick={handleStartGeneration}
              disabled={startingJob || !hasSavedResume || !selectedCompanyId || loadingCompanies}
              className={`w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl font-mono font-bold text-sm transition-all duration-300 ${
                !hasSavedResume || !selectedCompanyId
                  ? "bg-muted/20 text-muted-foreground cursor-not-allowed border border-border/30"
                  : "bg-accent hover:bg-accent/90 text-accent-foreground shadow-[0_0_30px_rgba(var(--accent-rgb),0.25)] hover:shadow-[0_0_50px_rgba(var(--accent-rgb),0.35)]"
              }`}
            >
              {startingJob ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" />
                  Queuing Generation Job...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Tailored Resume
                </>
              )}
            </button>
            {!hasSavedResume && !loadingResume && (
              <p className="text-center text-[10px] text-muted-foreground font-mono">
                Upload your master resume PDF above to enable generation.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
