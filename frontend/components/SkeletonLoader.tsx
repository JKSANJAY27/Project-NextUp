"use client";

import React from "react";

// ─── Base skeleton block ─────────────────────────────────────────────────────
interface SkeletonBlockProps {
  className?: string;
}

export function SkeletonBlock({ className = "" }: SkeletonBlockProps) {
  return (
    <div
      className={`skeleton ${className}`}
      role="status"
      aria-label="Loading..."
    />
  );
}

// ─── Skeleton text lines ─────────────────────────────────────────────────────
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading content...">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton h-3 ${i === lines - 1 ? "w-3/4" : "w-full"}`}
        />
      ))}
    </div>
  );
}

// ─── Skeleton stat card ──────────────────────────────────────────────────────
export function SkeletonStat() {
  return (
    <div
      className="border-2 border-border p-6 space-y-3"
      role="status"
      aria-label="Loading statistic..."
    >
      <div className="skeleton h-3 w-1/2" />
      <div className="skeleton h-8 w-2/3" />
      <div className="skeleton h-2 w-1/3" />
    </div>
  );
}

// ─── Skeleton company card ───────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div
      className="border-2 border-border p-6 space-y-4"
      role="status"
      aria-label="Loading company..."
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-3 w-1/3" />
        </div>
        <div className="skeleton h-8 w-20" />
      </div>
      <div className="space-y-2">
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-4/5" />
      </div>
      <div className="flex gap-2">
        <div className="skeleton h-6 w-16" />
        <div className="skeleton h-6 w-20" />
        <div className="skeleton h-6 w-14" />
      </div>
    </div>
  );
}

// ─── Skeleton table row ──────────────────────────────────────────────────────
export function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <div
      className="flex items-center gap-4 border-b border-border px-4 py-3"
      role="status"
      aria-label="Loading row..."
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className="skeleton h-3 flex-1" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

// ─── Skeleton table ──────────────────────────────────────────────────────────
export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="border-2 border-border" role="status" aria-label="Loading table...">
      {/* header */}
      <div className="flex items-center gap-4 border-b-2 border-border bg-muted/30 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton h-3 flex-1 opacity-50" />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </div>
  );
}

// ─── Full dashboard skeleton ─────────────────────────────────────────────────
export function SkeletonDashboard() {
  return (
    <div className="p-6 md:p-10 space-y-8" aria-live="polite" aria-label="Loading dashboard...">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>
      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
