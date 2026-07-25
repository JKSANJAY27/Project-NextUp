"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface CompensationDisplayProps {
  value?: string | null;
  stipend?: string | null;
  mode?: "table" | "card" | "detail";
  showLabel?: boolean;
  className?: string;
}

export function parseCompensationItems(rawText?: string | null): string[] {
  if (!rawText || !rawText.trim()) return [];
  
  // Split by line breaks or explicit bullets
  const lines = rawText
    .split(/\r?\n|;\s*(?=[A-Z0-9])/)
    .map((l) => l.replace(/^[•\-\*\s]+/, "").trim())
    .filter(Boolean);

  if (lines.length > 0) return lines;
  return [rawText.trim()];
}

export default function CompensationDisplay({
  value,
  stipend,
  mode = "detail",
  showLabel = false,
  className = "",
}: CompensationDisplayProps) {
  const [expanded, setExpanded] = useState(false);
  const items = parseCompensationItems(value);

  if (!items.length && (!stipend || stipend === "—")) {
    return <span className={`text-muted-foreground ${className}`}>—</span>;
  }

  const isMultiItem = items.length > 1;

  // 1. COMPACT TABLE MODE (Opportunities table / Archived table)
  if (mode === "table") {
    if (!isMultiItem) {
      return (
        <div className={`font-mono font-bold ${className}`}>
          <span>{items[0] || "—"}</span>
        </div>
      );
    }

    const firstItem = items[0];

    return (
      <div className={`relative inline-block ${className}`}>
        <div className="font-mono font-bold text-xs flex items-center gap-1.5 flex-wrap">
          <span className="truncate max-w-[180px]">{firstItem}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 bg-accent/15 border border-accent/40 text-accent hover:bg-accent hover:text-black transition-all rounded-none"
            title="Click to view full compensation breakdown"
          >

            {expanded ? "Show less" : "Show more"}
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        </div>

        {/* Dropdown breakdown popover for table cell */}
        {expanded && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-full mt-2 z-50 min-w-[280px] max-w-[340px] bg-background border-2 border-accent p-3.5 shadow-2xl space-y-2 text-left animate-in fade-in slide-in-from-top-2 duration-150"
          >
            <div className="flex items-center justify-between border-b border-border pb-1.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-accent flex items-center gap-1">
                💰 Compensation Structure
              </span>
              <button
                onClick={() => setExpanded(false)}
                className="text-[9px] text-muted-foreground hover:text-foreground font-bold uppercase"
              >
                Close
              </button>
            </div>
            <ul className="space-y-1.5 text-xs font-mono">
              {items.map((item, idx) => {
                const parts = item.split(":");
                const hasKey = parts.length > 1;
                return (
                  <li key={idx} className="flex flex-col text-[11px] leading-snug">
                    {hasKey ? (
                      <div>
                        <span className="font-bold text-muted-foreground uppercase text-[10px] block">
                          {parts[0].trim()}
                        </span>
                        <span className="font-bold text-foreground">
                          {parts.slice(1).join(":").trim()}
                        </span>
                      </div>
                    ) : (
                      <span className="font-bold text-foreground">{item}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {stipend && (
              <div className="pt-1.5 border-t border-border text-[10px] font-mono">
                <span className="text-muted-foreground font-bold uppercase">Stipend: </span>
                <span className="text-foreground font-bold">{stipend}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 2. CARD / DRAWER MODE
  if (mode === "card") {
    if (!isMultiItem) {
      return (
        <div className={`space-y-0.5 ${className}`}>
          {showLabel && (
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
              Package
            </p>
          )}
          <p className="text-xs font-mono font-bold uppercase">{items[0] || "—"}</p>
        </div>
      );
    }

    return (
      <div className={`space-y-1 ${className}`}>
        {showLabel && (
          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
            Package Details
          </p>
        )}
        <div className="space-y-1">
          {items.slice(0, expanded ? items.length : 2).map((item, idx) => (
            <div key={idx} className="text-xs font-mono font-bold leading-tight">
              <span className="text-foreground">{item}</span>
            </div>
          ))}
        </div>
        {items.length > 2 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-accent hover:underline mt-1"
          >
            {expanded ? "Show less" : "Show more"}
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>
    );
  }

  // 3. DETAIL / WORKSPACE MODAL OVERVIEW & JOB DETAILS TAB MODE
  return (
    <div className={`space-y-2 ${className}`}>
      {!isMultiItem ? (
        <span className="text-sm font-bold text-foreground block font-mono">
          {items[0] || "Will be announced later"}
        </span>
      ) : (
        <div className="space-y-2">
          <ul className="space-y-1.5 border-l-2 border-accent/40 pl-3">
            {items.slice(0, expanded ? items.length : 2).map((item, idx) => {
              const parts = item.split(":");
              const hasKey = parts.length > 1;
              return (
                <li key={idx} className="text-xs leading-relaxed">
                  {hasKey ? (
                    <div>
                      <span className="text-[10px] font-black uppercase text-muted-foreground tracking-wider block">
                        {parts[0].trim()}
                      </span>
                      <span className="text-sm font-bold font-mono text-foreground">
                        {parts.slice(1).join(":").trim()}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm font-bold font-mono text-foreground">{item}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {items.length > 2 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider bg-accent/10 border border-accent/40 text-accent hover:bg-accent hover:text-black transition-all mt-1"
            >
              {expanded ? "Show less" : "Show more"}
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
