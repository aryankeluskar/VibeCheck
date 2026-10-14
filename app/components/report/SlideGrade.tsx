"use client";

import type { AIReport } from "./types";
import type { AppMode } from "../../shared/mode";
import { getGradeColors } from "./types";

type Props = {
  report: AIReport;
  videoTitle: string;
  active: boolean;
  mode: AppMode;
};

export default function SlideGrade({ report, videoTitle, active, mode }: Props) {
  const gc = getGradeColors(report.grade, mode);
  const isGym = mode === "gym";

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-500 ${
        active ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Ring bursts */}
      {active && (
        <>
          <div
            className="report-ring"
            style={{ borderColor: gc.color, boxShadow: `0 0 30px ${gc.glow}` }}
          />
          <div
            className="report-ring report-ring-delay"
            style={{ borderColor: gc.color, boxShadow: `0 0 30px ${gc.glow}` }}
          />
          {/* Horizontal streaks */}
          <div className="report-streak report-streak-left" style={{ background: `linear-gradient(90deg, transparent, ${gc.color}aa, ${gc.glow}, transparent)`, boxShadow: `0 0 15px ${gc.glow}` }} />
          <div className="report-streak report-streak-right" style={{ background: `linear-gradient(90deg, transparent, ${gc.glow}, ${gc.color}aa, transparent)`, boxShadow: `0 0 15px ${gc.glow}` }} />
          {/* Diagonal flashes */}
          <div className="report-diag report-diag-1" style={{ background: `linear-gradient(90deg, transparent 30%, ${gc.glow} 50%, transparent 70%)` }} />
          <div className="report-diag report-diag-2" style={{ background: `linear-gradient(90deg, transparent 30%, ${gc.glow} 50%, transparent 70%)` }} />
        </>
      )}

      {/* Subheading label */}
      <div
        className="text-[11px] tracking-[0.4em] uppercase opacity-40 mb-4"
        style={{ fontFamily: "var(--font-audiowide)", color: gc.color }}
      >
        {isGym ? "Form Report" : "Performance Report"}
      </div>

      {/* Video title */}
      <div
        className="text-[13px] tracking-[0.3em] uppercase opacity-50 mb-8"
        style={{ fontFamily: "var(--font-audiowide)", color: gc.color }}
      >
        {videoTitle || (isGym ? "Workout Session" : "Dance Session")}
      </div>

      {/* Grade letter */}
      <div
        className={active ? "report-grade-slam" : ""}
        style={{
          fontSize: "clamp(6rem, 20vw, 14rem)",
          fontWeight: 900,
          lineHeight: 1,
          color: gc.color,
          textShadow: gc.shadow,
          fontFamily: "var(--font-audiowide)",
        }}
      >
        {report.grade}
      </div>

      {/* Headline */}
      <div
        className={active ? "report-subtitle-pop" : ""}
        style={{
          fontSize: "clamp(1.2rem, 3.5vw, 2.2rem)",
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          fontFamily: "var(--font-audiowide)",
          color: gc.color,
          textShadow: `0 0 15px ${gc.glow}, 0 0 40px ${gc.glow}`,
          marginTop: "1rem",
        }}
      >
        {report.headline}
      </div>
    </div>
  );
}
