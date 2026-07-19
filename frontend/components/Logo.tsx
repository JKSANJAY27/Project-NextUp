"use client";

import React, { useState } from "react";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export default function Logo({ className = "", size = "md" }: LogoProps) {
  const [attemptIndex, setAttemptIndex] = useState(0);
  const srcOptions = ["/logo.png", "/logo.svg", "/logo.jpg"];

  const hasImageFailed = attemptIndex >= srcOptions.length;

  // If all image loading attempts fail, render the stylized text.
  if (hasImageFailed) {
    return (
      <span className={`font-extrabold tracking-tighter uppercase leading-none text-foreground ${
        size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl"
      } ${className}`}>
        NEXTUP<span className="text-accent">.AI</span>
      </span>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={attemptIndex}
        src={srcOptions[attemptIndex]}
        alt="NextUp.AI Logo"
        className={`object-contain ${
          size === "sm" ? "h-6 w-auto" : size === "lg" ? "h-10 w-auto" : "h-8 w-auto"
        }`}
        onError={() => {
          setAttemptIndex((prev) => prev + 1);
        }}
      />
      <span className={`font-extrabold tracking-tighter uppercase leading-none text-foreground ${
        size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl"
      }`}>
        Nextup<span className="text-accent">AI</span>
      </span>
    </div>
  );
}
