"use client";

import { useState } from "react";
import { isMuted, setMuted } from "./speech";
import type { ComparisonResult } from "./compare";

type Props = {
  comparison: ComparisonResult | null;
  coachMessage: string;
};

export default function ComparisonPanel({ comparison, coachMessage }: Props) {
  const sim = comparison?.similarity ?? 0;
  const [muted, _setMuted] = useState(isMuted());
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    _setMuted(next);
  };

  const getColor = (score: number) => {
    if (score >= 80) return "text-green-400";
    if (score >= 50) return "text-yellow-400";
    return "text-red-400";
  };

  const getBarColor = (score: number) => {
    if (score >= 80) return "bg-green-400";
    if (score >= 50) return "bg-yellow-400";
    return "bg-red-400";
  };

  const getGlow = () => {
    if (sim >= 80) return "shadow-green-500/30";
    if (sim >= 50) return "shadow-yellow-500/30";
    return "shadow-red-500/30";
  };

  return (
    <div className="flex items-center gap-6 w-full px-6 py-4 bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10">
      {/* Match score circle */}
      <div
        className={`flex-shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center bg-black/60 shadow-lg ${getGlow()}`}
      >
        <span className={`text-3xl font-bold ${getColor(sim)}`}>{sim}</span>
        <span className="text-[10px] text-white/40 -mt-1">MATCH</span>
      </div>

      {/* Body part breakdown */}
      {comparison && (
        <div className="flex-shrink-0 flex flex-col gap-1.5 w-28">
          <PartBar
            label="Arms"
            score={comparison.parts.arms}
            getBarColor={getBarColor}
          />
          <PartBar
            label="Legs"
            score={comparison.parts.legs}
            getBarColor={getBarColor}
          />
          <PartBar
            label="Torso"
            score={comparison.parts.torso}
            getBarColor={getBarColor}
          />
        </div>
      )}

      {/* Coach feedback */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-white/40 uppercase tracking-widest mb-1">
          Coach says
        </p>
        <p className="text-white text-lg font-medium truncate">
          {coachMessage ||
            comparison?.feedback[0] ||
            "Get ready to dance!"}
        </p>
        {comparison && comparison.feedback.length > 1 && (
          <p className="text-white/40 text-xs mt-1 truncate">
            {comparison.feedback.slice(1).join(" · ")}
          </p>
        )}
      </div>

      {/* Overall bar */}
      <div className="hidden sm:block flex-shrink-0 w-32">
        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${sim}%`,
              background:
                sim >= 80
                  ? "linear-gradient(90deg, #22c55e, #4ade80)"
                  : sim >= 50
                  ? "linear-gradient(90deg, #eab308, #facc15)"
                  : "linear-gradient(90deg, #ef4444, #f87171)",
            }}
          />
        </div>
      </div>

      {/* Mute button */}
      <button
        onClick={toggleMute}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white/50 hover:text-white/80 hover:bg-white/20 transition-colors"
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

function PartBar({
  label,
  score,
  getBarColor,
}: {
  label: string;
  score: number;
  getBarColor: (s: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40 w-10 text-right">
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${getBarColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-[10px] text-white/50 w-6">{score}</span>
    </div>
  );
}
