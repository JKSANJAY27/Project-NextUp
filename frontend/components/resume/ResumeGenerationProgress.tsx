import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Loader2, AlertCircle, XCircle, Clock, Zap } from "lucide-react";

interface ResumeGenerationProgressProps {
  jobId: string;
  onComplete: (result: any) => void;
  onCancel: () => void;
}

type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export default function ResumeGenerationProgress({
  jobId,
  onComplete,
  onCancel
}: ResumeGenerationProgressProps) {
  const [status, setStatus] = useState<JobStatus>("queued");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

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
      } catch (err: any) {
        console.error("Failed to fetch job status:", err);
      }
    };

    // Run immediately, then poll
    checkJobStatus();
    intervalId = setInterval(checkJobStatus, 3000);

    return () => clearInterval(intervalId);
  }, [jobId, onComplete, onCancel]);

  const handleCancelJob = async () => {
    try {
      setCancelling(true);
      await api.post(`/resumes/jobs/${jobId}/cancel`);
      onCancel();
    } catch (err: any) {
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
              Waiting for an active resume tailoring worker thread. Do not close this page — your job will be picked up momentarily.
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
            <h3 className="font-mono text-base font-bold tracking-tight text-accent animate-pulse">
              TAILORING RESUME...
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI is aligning your skills, summary, and experience highlights against the target JD strategy. Applying strict verification rules to prevent hallucinations.
            </p>
          </div>
          <div className="w-full bg-border h-1.5 rounded-full overflow-hidden">
            <div className="bg-accent h-full w-2/3 rounded-full animate-shimmer" />
          </div>
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
