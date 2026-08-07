"use client";

import React, { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

export default function HeroScene() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.error("Video play failed:", err);
      });
    }
  };

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden bg-[#09090E]" aria-hidden="true">
      {/* Background Video */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setIsVideoLoaded(true)}
        onError={() => setVideoError(true)}
        className={`absolute inset-0 w-full h-full object-cover object-center md:object-right-bottom transition-opacity duration-1000 ${
          isVideoLoaded ? "opacity-75" : "opacity-0"
        }`}
      >
        <source src="/videos/hero.mp4" type="video/mp4" />
      </video>

      {/* Ambient Animated Fallback Glow (visible while video loads or if video fails) */}
      {(!isVideoLoaded || videoError) && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/15 via-background to-background animate-pulse" />
      )}

      {/* Dark Readability Scrim Overlay — Ensures maximum text legibility for the hero content */}
      {/* Mobile: uniform dark overlay since video is centered behind full-width text */}
      {/* Desktop: left-to-right gradient revealing the video on the right */}
      <div 
        className="absolute inset-0 pointer-events-none z-10 md:hidden"
        style={{
          background: "linear-gradient(to bottom, rgba(9,9,14,0.88) 0%, rgba(9,9,14,0.72) 40%, rgba(9,9,14,0.55) 65%, rgba(9,9,14,0.85) 100%)"
        }}
      />
      <div 
        className="absolute inset-0 pointer-events-none z-10 hidden md:block"
        style={{
          background: "linear-gradient(to right, rgba(9,9,14,0.96) 0%, rgba(9,9,14,0.85) 45%, rgba(9,9,14,0.45) 75%, rgba(9,9,14,0.55) 100%), linear-gradient(to top, rgba(9,9,14,1) 0%, rgba(9,9,14,0.98) 6%, rgba(9,9,14,0.85) 14%, transparent 36%)"
        }}
      />

      {/* Subtle Scanline Overlay for Cyber/Tech Aesthetic */}
      <div className="absolute inset-0 pointer-events-none z-10 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.18)_0px,rgba(0,0,0,0.18)_1px,transparent_1px,transparent_4px)] opacity-40" />

      {/* Video Control Toggle Badge (Bottom Right) */}
      <div className="absolute bottom-6 right-6 z-20 pointer-events-auto flex items-center gap-2">
        <button
          onClick={togglePlay}
          className="flex items-center gap-2 border-2 border-border bg-black/80 backdrop-blur-md px-3 py-1.5 text-[11px] font-extrabold tracking-widest text-accent uppercase hover:border-accent hover:bg-black transition-all active:scale-95 shadow-lg"
          aria-label={isPlaying ? "Pause background video" : "Play background video"}
          title="Toggle background video playback"
        >
          {isPlaying ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
              </span>
              <Pause size={12} className="text-accent" />
              <span>BG VIDEO ACTIVE</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-muted-foreground" />
              <Play size={12} className="text-muted-foreground" />
              <span>PAUSED</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

