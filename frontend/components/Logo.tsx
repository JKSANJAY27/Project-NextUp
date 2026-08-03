"use client";

import React, { useState, useEffect } from "react";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  onAccent?: boolean;
  variant?: "auto" | "light" | "dark";
}

function TieLogoIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 556 761"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <g stroke="#000000" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round">
        {/* Left Collar */}
        <polygon points="76,20 20,119 159,287 262,168" fill="#FFFFFF" />
        {/* Right Collar */}
        <polygon points="480,22 535,120 399,288 294,170" fill="#FFFFFF" />
        {/* Knot */}
        <polygon points="278,216 343,288 315,356 239,356 212,287" fill="#DFE104" />
        {/* Tie Body */}
        <polygon points="239,395 317,397 369,645 279,740 188,650" fill="#DFE104" />
      </g>
    </svg>
  );
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
    ? ["/logo_light.svg", "/logo.svg", "/logo_light.png", "/logo.png", "/logo.jpg"]
    : ["/logo.svg", "/logo_light.svg", "/logo.png", "/logo_light.png", "/logo.jpg"];

  const hasImageFailed = attemptIndex >= srcOptions.length;

  const sizeClasses =
    size === "sm" ? "h-6 w-auto" : size === "lg" ? "h-10 w-auto" : "h-8 w-auto";

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {!hasImageFailed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={srcOptions[attemptIndex] + attemptIndex}
          src={srcOptions[attemptIndex]}
          alt="NextUp.AI Logo"
          className={`object-contain ${sizeClasses}`}
          onError={() => {
            setAttemptIndex((prev) => prev + 1);
          }}
        />
      ) : (
        <TieLogoIcon className={sizeClasses} />
      )}
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

