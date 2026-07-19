"use client";

import React, { useState } from "react";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  onAccent?: boolean;
}

export default function Logo({ className = "", size = "md", onAccent = false }: LogoProps) {
  const [attemptIndex, setAttemptIndex] = useState(0);
  const srcOptions = ["/logo.png", "/logo.svg", "/logo.jpg"];

  const hasImageFailed = attemptIndex >= srcOptions.length;

  // If all image loading attempts fail, render the stylized text.
  if (hasImageFailed) {
    return (
      <span className={`font-extrabold tracking-tighter uppercase leading-none ${
        onAccent ? "text-black" : "text-foreground"
      } ${
        size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl"
      } ${className}`}>
        NEXTUP<span className={onAccent ? "opacity-75" : "text-accent"}>.AI</span>
      </span>
    );
  }

  // Crisp black outline + soft shadow for transparent PNG on yellow accent background
  const imgStyle = onAccent
    ? {
        filter:
          "drop-shadow(1px 0px 0px #000) drop-shadow(-1px 0px 0px #000) drop-shadow(0px 1px 0px #000) drop-shadow(0px -1px 0px #000) drop-shadow(0px 2px 3px rgba(0,0,0,0.4))",
      }
    : undefined;

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
        style={imgStyle}
        onError={() => {
          setAttemptIndex((prev) => prev + 1);
        }}
      />
      <span className={`font-extrabold tracking-tighter uppercase leading-none ${
        onAccent ? "text-black" : "text-foreground"
      } ${
        size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl"
      }`}>
        Nextup<span className={onAccent ? "opacity-75" : "text-accent"}>AI</span>
      </span>
    </div>
  );
}
