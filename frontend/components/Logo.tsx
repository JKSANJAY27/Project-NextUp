"use client";

import React, { useState } from "react";
import Image from "next/image";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export default function Logo({ className = "", size = "md" }: LogoProps) {
  const [attemptIndex, setAttemptIndex] = useState(0);
  const srcOptions = ["/logo.jpg", "/logo.png", "/logo.svg"];

  // Define sizes matching the context where the logo is used
  const dimensions = {
    sm: { height: 24, className: "h-6 w-auto" },  // Mobile header / small elements
    md: { height: 32, className: "h-8 w-auto" },  // Main landing header / sidebar mobile
    lg: { height: 40, className: "h-10 w-auto" }  // Sidebar desktop header
  };

  const current = dimensions[size];
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
