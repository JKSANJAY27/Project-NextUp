"use client";

import React from "react";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "right";
  className?: string;
}

/**
 * Accessible tooltip component. Wraps any child element.
 * Shows tooltip text on hover and keyboard focus.
 *
 * Usage:
 *   <Tooltip content="This unlocks after profile setup">
 *     <button>...</button>
 *   </Tooltip>
 */
export default function Tooltip({
  content,
  children,
  position = "top",
  className = "",
}: TooltipProps) {
  const positionClass =
    position === "bottom"
      ? "tooltip-bottom"
      : position === "right"
      ? "tooltip-right"
      : "";

  return (
    <span className={`tooltip-wrapper ${className}`} tabIndex={-1}>
      {children}
      <span
        className={`tooltip-content ${positionClass}`}
        role="tooltip"
        aria-hidden="true"
      >
        {content}
      </span>
    </span>
  );
}
