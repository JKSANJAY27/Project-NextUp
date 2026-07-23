"use client";

import React, { useState, useEffect } from "react";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  onAccent?: boolean;
  variant?: "auto" | "light" | "dark";
}

export default function Logo({
  className = "",
  size = "md",
  onAccent = false,
  variant = "auto",
}: LogoProps) {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [attemptIndex, setAttemptIndex] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkTheme = () => {
      if (variant === "light") {
        setIsDarkMode(false);
      } else if (variant === "dark") {
        setIsDarkMode(true);
      } else {
        const isDark = document.documentElement.classList.contains("dark");
        setIsDarkMode(isDark);
      }
    };

    checkTheme();

    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        checkTheme();
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      return () => observer.disconnect();
    }
  }, [variant]);

  const useLightLogo = !isDarkMode || onAccent;
  const srcOptions = useLightLogo
    ? ["/logo_light.png", "/logo.png", "/logo.svg", "/logo.jpg"]
    : ["/logo.png", "/logo_light.png", "/logo.svg", "/logo.jpg"];

  const hasImageFailed = attemptIndex >= srcOptions.length;

  if (hasImageFailed) {
    return (
      <span
        className={`font-extrabold tracking-tighter uppercase leading-none ${
          onAccent ? "text-black" : "text-foreground"
        } ${
          size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl"
        } ${className}`}
      >
        NEXTUP<span className={onAccent ? "opacity-75" : "text-accent"}>.AI</span>
      </span>
    );
  }

  const currentSrc = srcOptions[attemptIndex];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={currentSrc + attemptIndex}
        src={currentSrc}
        alt="NextUp.AI Logo"
        className={`object-contain ${
          size === "sm" ? "h-6 w-auto" : size === "lg" ? "h-10 w-auto" : "h-8 w-auto"
        }`}
        onError={() => {
          setAttemptIndex((prev) => prev + 1);
        }}
      />
      <span
        className={`font-extrabold tracking-tighter uppercase leading-none ${
          onAccent ? "text-black" : "text-foreground"
        } ${
          size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl"
        }`}
      >
        Nextup<span className={onAccent ? "opacity-75" : "text-accent"}>AI</span>
      </span>
    </div>
  );
}

