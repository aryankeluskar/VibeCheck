"use client";

import { useState, useEffect, useCallback } from "react";
import type { ReportCardProps } from "./types";
import SlideGrade from "./SlideGrade";
import SlideBody from "./SlideBody";
import SlideVibe from "./SlideVibe";
import SlideLevelUp from "./SlideLevelUp";

const TOTAL_SLIDES = 4;

export default function ReportCard({
  stats,
  report,
  mode,
  videoTitle,
  loading,
  onClose,
  recordingUrl,
  recordingUploading,
}: ReportCardProps) {
  const [slide, setSlide] = useState(0);
  const isGym = mode === "gym";

  const advance = useCallback(() => {
    if (slide >= TOTAL_SLIDES - 1) {
      onClose();
    } else {
      setSlide((s) => s + 1);
    }
  }, [slide, onClose]);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reset slide when opening
  useEffect(() => {
    setSlide(0);
  }, [report]);

  const dotColor = isGym ? "#a0d4ff" : "#00ffff";
  const dotGlow = isGym
    ? "0 0 8px rgba(160,212,255,0.6), 0 0 20px rgba(160,212,255,0.3)"
    : "0 0 8px rgba(0,255,255,0.6), 0 0 20px rgba(0,255,255,0.3)";

  return (
    <div
      className={isGym ? "report-overlay report-overlay-gym" : "report-overlay"}
      onClick={advance}
    >
      {/* Loading state */}
      {loading && !report && (
        <div className="flex flex-col items-center gap-4 z-10">
          <div
            className="text-lg tracking-[0.3em] uppercase neon-text-cyan animate-glow-pulse"
            style={{ fontFamily: "var(--font-audiowide)" }}
          >
            {isGym ? "Analyzing your form..." : "Analyzing your moves..."}
          </div>
          <div className="w-48 h-1 rounded-full overflow-hidden bg-black/40 border border-neon-cyan/10">
            <div className="h-full neon-progress" style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {/* Slides */}
      {report && (
        <>
          <SlideGrade report={report} videoTitle={videoTitle} active={slide === 0} mode={mode} />
          <SlideBody stats={stats} report={report} active={slide === 1} mode={mode} />
          <SlideVibe stats={stats} report={report} active={slide === 2} mode={mode} />
          <SlideLevelUp report={report} active={slide === 3} onClose={onClose} mode={mode} recordingUrl={recordingUrl} recordingUploading={recordingUploading} />

          {/* Dot navigation */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2 z-20">
            {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setSlide(i);
                }}
                className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                style={{
                  background: i === slide ? dotColor : "rgba(255,255,255,0.2)",
                  boxShadow: i === slide ? dotGlow : "none",
                  transform: i === slide ? "scale(1.3)" : "scale(1)",
                }}
              />
            ))}
          </div>

          {/* Tap hint on first slide */}
          {slide === 0 && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.3em] uppercase text-white/30 animate-glow-pulse"
              style={{ fontFamily: "var(--font-audiowide)" }}
            >
              Tap to continue
            </div>
          )}
        </>
      )}
    </div>
  );
}
