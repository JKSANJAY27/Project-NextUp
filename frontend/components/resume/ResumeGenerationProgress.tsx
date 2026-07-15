import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Loader2, AlertCircle, XCircle, Clock } from "lucide-react";

interface ResumeGenerationProgressProps {
  jobId: string;
  onComplete: (result: Record<string, unknown>) => void;
  onCancel: () => void;
}

type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

// Typical duration on the free-tier inference Space. Used only for the soft
// progress bar / countdown — the real signal is the job status poll.
const EXPECTED_SECONDS = 240;

// Rotating status lines so a multi-minute generation never looks frozen.
const PROCESSING_STAGES = [
  "Loading your master resume snapshot...",
  "Reading the company's JD strategy and ATS keywords...",
  "Ranking your skills against the JD (deterministic, no AI)...",
  "Selecting your most JD-relevant projects...",
  "Rewriting the professional summary on the inference Space...",
  "Rephrasing project impact bullets with JD terminology...",
  "Running anti-hallucination checks against your real resume...",
  "Computing the ATS keyword coverage report...",
  "Almost there — finalizing suggestions...",
];

export default function ResumeGenerationProgress({
  jobId,
  onComplete,
  onCancel
}: ResumeGenerationProgressProps) {
  const [status, setStatus] = useState<JobStatus>("queued");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed-seconds ticker (drives the stage text, progress % and ETA)
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const stageIdx = Math.min(
    PROCESSING_STAGES.length - 1,
    Math.floor(elapsed / (EXPECTED_SECONDS / PROCESSING_STAGES.length))
  );
  // Asymptotic progress: fills to ~95% over the expected duration, never 100
  const progressPct = Math.min(95, Math.round((elapsed / EXPECTED_SECONDS) * 90));
  const remaining = Math.max(0, EXPECTED_SECONDS - elapsed);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  useEffect(() => {
    const checkJobStatus = async () => {
      try {
        const res = await api.get(`/resumes/jobs/${jobId}`);
        const data = res.data;
        setStatus(data.status);
        
        if (data.status === "completed") {
          clearInterval(intervalId);
          onComplete(data.result);
        } else if (data.status === "failed") {
          clearInterval(intervalId);
          setErrorMsg(data.error_message || "An unexpected error occurred during resume tailoring.");
        } else if (data.status === "cancelled") {
          clearInterval(intervalId);
          onCancel();
        }
      } catch (err: unknown) {
        console.error("Failed to fetch job status:", err);
      }
    };

    // Run immediately, then poll
    checkJobStatus();
    const intervalId = setInterval(checkJobStatus, 3000);

    return () => clearInterval(intervalId);
  }, [jobId, onComplete, onCancel]);

  const handleCancelJob = async () => {
    try {
      setCancelling(true);
      await api.post(`/resumes/jobs/${jobId}/cancel`);
      onCancel();
    } catch (err: unknown) {
      console.error("Failed to cancel job:", err);
      setCancelling(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 min-h-[400px] text-center max-w-md mx-auto space-y-6">
      {status === "queued" && (
        <>
          <div className="relative">
            <div className="absolute inset-0 bg-accent/20 rounded-full blur-xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-full border-2 border-border flex items-center justify-center bg-card/80">
              <Clock className="h-8 w-8 text-muted-foreground animate-spin-slow" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="font-mono text-base font-bold tracking-tight">
              JOB IN QUEUE
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Waiting for a resume tailoring worker to pick this up (usually under a minute).
              You can leave this page — the job runs on the server and will be here when you return.
            </p>
          </div>
          <button
            onClick={handleCancelJob}
            disabled={cancelling}
            className="flex items-center gap-2 border border-destructive/30 hover:border-destructive text-destructive bg-destructive/5 hover:bg-destructive/10 text-xs font-mono py-2 px-4 rounded-lg transition"
          >
            {cancelling ? (
              <Loader2 className="animate-spin h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Cancel Generation Request
          </button>
        </>
      )}

      {status === "processing" && (
        <>
          <div className="relative">
            <div className="absolute inset-0 bg-accent/30 rounded-full blur-2xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-full border-2 border-accent flex items-center justify-center bg-card">
              <Loader2 className="h-8 w-8 text-accent animate-spin" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="font-mono text-base font-bold tracking-tight text-accent">
              TAILORING RESUME...
            </h3>
            {/* Rotating stage line — changes every ~25s so it's visibly alive */}
            <p className="text-xs text-foreground font-mono min-h-[2rem] transition-all">
              {PROCESSING_STAGES[stageIdx]}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">
              Elapsed {fmt(elapsed)}
              {remaining > 0
                ? ` · est. ~${fmt(remaining)} remaining`
                : " · taking longer than usual (free-tier hardware) — still working"}
            </p>
          </div>
          <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-accent h-full rounded-full transition-all duration-1000"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground leading-relaxed border border-border/40 bg-muted/10 rounded-lg p-2.5">
            💡 You can safely leave this page — generation continues on the server.
            When you come back to the Resume page, it will re-attach to this job
            (or show the finished result) automatically.
          </p>
        </>
      )}

      {status === "failed" && (
        <>
          <div className="relative">
            <div className="absolute inset-0 bg-destructive/15 rounded-full blur-xl" />
            <div className="relative w-16 h-16 rounded-full border-2 border-destructive flex items-center justify-center bg-card">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="font-mono text-base font-bold tracking-tight text-destructive">
              GENERATION FAILED
            </h3>
            <p className="text-xs text-destructive/80 font-mono bg-destructive/5 border border-destructive/10 p-3 rounded-lg text-left overflow-auto max-h-32">
              {errorMsg}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="border border-border hover:border-muted-foreground text-foreground text-xs font-mono py-2 px-4 rounded-lg transition"
          >
            Go Back
          </button>
        </>
      )}
    </div>
  );
}
