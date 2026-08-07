"use client";

import React from "react";

export type TooltipPosition =
  | "top"
  | "top-right"
  | "top-left"
  | "bottom"
  | "bottom-right"
  | "bottom-left"
  | "right"
  | "left";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: TooltipPosition;
  className?: string;
}

/**
 * Accessible, modern tooltip component. Wraps any child element.
 * Shows sleek, styled tooltip box on hover and keyboard focus.
 */
export default function Tooltip({
  content,
  children,
  position = "top",
  className = "",
}: TooltipProps) {
  const positionClass = `tooltip-${position}`;

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

