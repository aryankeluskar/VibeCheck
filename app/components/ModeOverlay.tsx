"use client";

import { useState, useEffect } from "react";
import type { AppMode } from "../shared/mode";

interface ModeOverlayProps {
  mode: AppMode;
  seq: number;
}

export default function ModeOverlay({ mode, seq }: ModeOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [activeMode, setActiveMode] = useState<AppMode>(mode);

  useEffect(() => {
    if (seq === 0) return;
    setActiveMode(mode);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [seq, mode]);

  if (!visible) return null;

  const isGym = activeMode === "gym";
  const prefix = isGym ? "gym" : "dance";

  return (
    <div className={`mode-overlay mode-overlay-${prefix}`}>
      {/* Expanding ring burst */}
      <div className={`mode-ring mode-ring-${prefix}`} />
      <div className={`mode-ring mode-ring-${prefix} mode-ring-delay`} />

      {/* Horizontal streak lines */}
      <div className={`mode-streak mode-streak-left mode-streak-${prefix}`} />
      <div className={`mode-streak mode-streak-right mode-streak-${prefix}`} />

      {/* Diagonal accent lines */}
      <div className={`mode-diag mode-diag-1 mode-diag-${prefix}`} />
      <div className={`mode-diag mode-diag-2 mode-diag-${prefix}`} />

      {/* Center content */}
      <div className="mode-content">
        {/* Top accent line */}
        <div className={`mode-accent-line mode-accent-${prefix}`} />

        <div
          className={`mode-text mode-text-${prefix}`}
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {isGym ? "BEAST MODE" : "LET'S GROOVE"}
        </div>

        <div
          className={`mode-subtitle mode-subtitle-${prefix}`}
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {isGym ? "TIME TO COOK" : "SHOW YOUR MOVES"}
        </div>

        {/* Bottom accent line */}
        <div className={`mode-accent-line mode-accent-${prefix} mode-accent-bottom`} />
      </div>
    </div>
  );
}
