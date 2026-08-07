"use client";

export default function HeaderPulse() {
  return (
    <div className="flex items-center gap-3" aria-label="NextUp is online">
      <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" /></span>
      <div className="flex h-4 items-end gap-1" aria-hidden="true"><span className="h-2 w-1 animate-[pulse_1.4s_ease-in-out_infinite] bg-accent/40" /><span className="h-4 w-1 animate-[pulse_1.4s_ease-in-out_0.2s_infinite] bg-accent" /><span className="h-3 w-1 animate-[pulse_1.4s_ease-in-out_0.4s_infinite] bg-accent/60" /><span className="h-1.5 w-1 animate-[pulse_1.4s_ease-in-out_0.6s_infinite] bg-accent/30" /></div>
      <span className="font-mono text-[10px] font-bold tracking-[0.28em] text-muted-foreground uppercase">Live</span>
    </div>
  );
}
