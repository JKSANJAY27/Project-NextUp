import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface TrackingSectionProps {
  title: string;
  count: number;
  colorClass: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export default function TrackingSection({
  title,
  count,
  colorClass,
  children,
  defaultExpanded = false,
}: TrackingSectionProps) {
  // If count > 0, we auto expand by default, else use defaultExpanded (usually false)
  const [expanded, setExpanded] = useState(count > 0 || defaultExpanded);

  // Update expanded if count changes to > 0
  React.useEffect(() => {
    if (count > 0) {
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [count]);

  return (
    <div className="mb-6 border-2 border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between p-4 hover:bg-muted transition-colors ${
          expanded ? "border-b-2 border-border" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 ${colorClass}`} />
          <h2 className="text-sm font-black uppercase tracking-widest">
            {title} <span className="text-muted-foreground ml-2">({count})</span>
          </h2>
        </div>
        <div className="text-muted-foreground">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="p-4 bg-muted/10">
          {count === 0 ? (
            <div className="text-center py-8 text-xs font-bold text-muted-foreground uppercase tracking-widest border-2 border-dashed border-border">
              No companies in this stage
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {children}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
