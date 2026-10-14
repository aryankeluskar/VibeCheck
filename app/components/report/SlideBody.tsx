"use client";

import type { AIReport } from "./types";
import type { AppMode } from "../../shared/mode";
import { LIMB_LABELS, limbAverage, getGradeColors } from "./types";
import type { SessionStats } from "../../lib/sessionStats";

type Props = {
  stats: SessionStats;
  report: AIReport;
  active: boolean;
  mode: AppMode;
};

function barColor(score: number, isGym: boolean): { bg: string; glow: string } {
  if (isGym) {
    if (score >= 80) return { bg: "linear-gradient(90deg, #4ade80, #a0d4ff)", glow: "0 0 8px rgba(74,222,128,0.6), 0 0 20px rgba(74,222,128,0.3)" };
    if (score >= 50) return { bg: "linear-gradient(90deg, #ffb347, #ff8c42)", glow: "0 0 8px rgba(255,179,71,0.6), 0 0 20px rgba(255,179,71,0.3)" };
    return { bg: "linear-gradient(90deg, #ff4444, #ff6b2b)", glow: "0 0 8px rgba(255,68,68,0.6), 0 0 20px rgba(255,68,68,0.3)" };
  }
  if (score >= 80) return { bg: "linear-gradient(90deg, #39ff14, #00ffcc)", glow: "0 0 8px rgba(57,255,20,0.6), 0 0 20px rgba(57,255,20,0.3)" };
  if (score >= 50) return { bg: "linear-gradient(90deg, #ffe100, #ff9900)", glow: "0 0 8px rgba(255,225,0,0.6), 0 0 20px rgba(255,225,0,0.3)" };
  return { bg: "linear-gradient(90deg, #ff003c, #ff6b2b)", glow: "0 0 8px rgba(255,0,60,0.6), 0 0 20px rgba(255,0,60,0.3)" };
}

function textColor(score: number, isGym: boolean): string {
  if (isGym) {
    if (score >= 80) return "#4ade80";
    if (score >= 50) return "#ffb347";
    return "#ff4444";
  }
  if (score >= 80) return "#39ff14";
  if (score >= 50) return "#ffe100";
  return "#ff003c";
}

export default function SlideBody({ stats, report, active, mode }: Props) {
  const isGym = mode === "gym";
  const gc = getGradeColors(report.grade, mode);
  const avgs = limbAverage(stats.limbTotals);
  const limbs = ["rightArm", "leftArm", "rightLeg", "leftLeg", "torso"];

  const entries = Object.entries(avgs);
  const bestKey = entries.length > 0 ? entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : "";
  const worstKey = entries.length > 0 ? entries.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : "";

  const titleColor = isGym ? gc.color : undefined;

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center px-8 transition-opacity duration-500 ${
        active ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Title */}
      <div
        className={`text-base tracking-[0.5em] uppercase mb-10 ${isGym ? "" : "neon-text-cyan"}`}
        style={{
          fontFamily: "var(--font-audiowide)",
          ...(isGym ? {
            color: gc.color,
            textShadow: `0 0 7px ${gc.glow}, 0 0 20px ${gc.glow}`,
          } : {}),
        }}
      >
        {isGym ? "Your Form" : "Your Body"}
      </div>

      {/* Limb bars */}
      <div className="w-full max-w-lg flex flex-col gap-5">
        {limbs.map((key, i) => {
          const score = avgs[key] ?? 0;
          const label = LIMB_LABELS[key] ?? key;
          const isBest = key === bestKey;
          const isWorst = key === worstKey;
          const { bg, glow } = barColor(score, isGym);

          return (
            <div key={key} className="flex items-center gap-4">
              {/* Label */}
              <div className="w-28 flex items-center gap-2">
                <span
                  className="text-[13px] tracking-[0.15em] uppercase whitespace-nowrap"
                  style={{ fontFamily: "var(--font-audiowide)", color: textColor(score, isGym) }}
                >
                  {label}
                </span>
                {isWorst && (
                  <span
                    className="text-[8px] tracking-wider uppercase px-1.5 py-0.5 rounded border"
                    style={{
                      background: isGym ? "rgba(255,68,68,0.15)" : "rgba(255,0,60,0.15)",
                      color: isGym ? "#ff6b6b" : "#ff4444",
                      borderColor: isGym ? "rgba(255,68,68,0.3)" : "rgba(255,0,60,0.3)",
                    }}
                  >
                    {isGym ? "fix" : "weak"}
                  </span>
                )}
              </div>

              {/* Bar */}
              <div className="flex-1 h-4 rounded-full bg-white/5 overflow-hidden relative">
                <div
                  className={`h-full rounded-full ${active ? "report-bar-fill" : ""}`}
                  style={{
                    ["--bar-target" as string]: `${Math.min(score, 100)}%`,
                    background: bg,
                    boxShadow: glow,
                    animationDelay: `${i * 0.12}s`,
                    ...(isBest ? { animation: `report-bar-fill 0.8s ${i * 0.12}s cubic-bezier(0.16, 1, 0.3, 1) forwards, report-pulse-glow 1.5s ${i * 0.12 + 0.8}s ease-in-out infinite` } : {}),
                  }}
                />
              </div>

              {/* Score */}
              <span
                className="w-10 text-right text-[15px] font-bold"
                style={{ fontFamily: "var(--font-audiowide)", color: textColor(score, isGym) }}
              >
                {score}
              </span>
            </div>
          );
        })}
      </div>

      {/* Best/worst callout */}
      <div className="mt-8 flex gap-8 text-[13px] tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-audiowide)" }}>
        <span style={{ color: isGym ? "rgba(74,222,128,0.8)" : "rgba(57,255,20,0.8)" }}>
          {isGym ? "Strongest:" : "Best:"} {report.bestLimb}
        </span>
        <span style={{ color: isGym ? "rgba(255,107,43,0.8)" : "rgba(255,0,60,0.8)" }}>
          {isGym ? "Focus on:" : "Worst:"} {report.worstLimb}
        </span>
      </div>
    </div>
  );
}
