"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { isMuted, setMuted } from "../shared/speech";
import type { AppMode } from "../shared/mode";

type Props = {
  score: number;
  message: string;
  showScore?: boolean;
  mode?: AppMode;
};

// Compute a single RGB color that smoothly maps to score tier
function scoreToColor(score: number): { r: number; g: number; b: number } {
  if (score >= 80) return { r: 57, g: 255, b: 20 };
  if (score >= 50) return { r: 255, g: 225, b: 0 };
  return { r: 255, g: 0, b: 60 };
}

function scoreToLabel(score: number): string {
  if (score >= 90) return "PERFECT";
  if (score >= 80) return "FIRE";
  if (score >= 60) return "GOOD";
  if (score >= 40) return "MOVE";
  return "";
}

export default function CoachPanel({ score, message, showScore, mode = "dance" }: Props) {
  const [muted, _setMuted] = useState(isMuted());
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    _setMuted(next);
  };

  // Track label changes for bounce animation
  const label = scoreToLabel(score);
  const prevLabelRef = useRef(label);
  const [labelBounce, setLabelBounce] = useState(false);

  useEffect(() => {
    if (label && label !== prevLabelRef.current) {
      setLabelBounce(true);
      const t = setTimeout(() => setLabelBounce(false), 400);
      prevLabelRef.current = label;
      return () => clearTimeout(t);
    }
    prevLabelRef.current = label;
  }, [label]);

  // All reactive colors as inline styles for smooth CSS transitions
  const c = useMemo(() => scoreToColor(score), [score]);
  const rgba = (a: number) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;

  const glowIntensity = score >= 80 ? 1 : score >= 50 ? 0.7 : 0.4;

  return (
    <div
      className="flex items-center gap-5 w-full px-5 py-3 bg-black/50 rounded relative overflow-hidden"
      style={{
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: rgba(score > 0 ? 0.25 : 0.08),
        transition: "border-color 0.6s ease, box-shadow 0.6s ease",
        boxShadow: score > 0
          ? `0 0 ${8 * glowIntensity}px ${rgba(0.15)}, inset 0 0 ${12 * glowIntensity}px ${rgba(0.03)}`
          : "none",
      }}
    >
      {/* HUD corners */}
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-neon-cyan/30 z-10" />
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-neon-cyan/30 z-10" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-neon-cyan/30 z-10" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-neon-cyan/30 z-10" />

      {/* Coach message */}
      <div className="flex-1 min-w-0 pl-2">
        <p
          className="text-[11px] tracking-[0.25em] uppercase text-neon-violet/70 mb-1"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {mode === "gym" ? "Form Coach" : "AI Coach"}
        </p>
        <p
          className="text-white/90 text-base font-medium truncate"
          style={{ fontFamily: "var(--font-chakra-petch)" }}
        >
          {message || (mode === "gym"
            ? "Ready to check your form. Let\u2019s work."
            : "Step into the arena. Show me what you\u2019ve got.")}
        </p>
      </div>

      {/* Mute toggle */}
      <button
        onClick={toggleMute}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded border border-neon-cyan/15 bg-black/40 text-white/50 hover:text-white/80 hover:border-neon-cyan/30 transition-colors"
        title={muted ? "Unmute coach" : "Mute coach"}
      >
        {muted ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 010 14.14" />
            <path d="M15.54 8.46a5 5 0 010 7.07" />
          </svg>
        )}
      </button>
    </div>
  );
}
