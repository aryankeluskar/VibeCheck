"use client";

import { useEffect, useState } from "react";
import type { GestureAction } from "../lib/gestureControl";

const ACTION_META: Record<GestureAction, { icon: string; label: string }> = {
  play_pause: { icon: "\u23EF", label: "Play / Pause" },
  skip_forward: { icon: "\u23E9", label: "Skip +5s" },
  skip_backward: { icon: "\u23EA", label: "Skip -5s" },
  restart: { icon: "\u23EE", label: "Restart" },
};

type GestureToastProps = {
  action: GestureAction | null;
  /** Incremented each time a new toast should appear (even for same action) */
  seq: number;
};

export function GestureToast({ action, seq }: GestureToastProps) {
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<GestureAction | null>(null);

  useEffect(() => {
    if (!action) return;
    setDisplay(action);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timer);
  }, [action, seq]);

  if (!display) return null;

  const meta = ACTION_META[display];

  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? 0 : -12}px)`,
        transition: "opacity 0.3s ease, transform 0.3s ease",
      }}
    >
      <div
        className="flex items-center gap-3 px-6 py-3 bg-black/85 border border-neon-cyan/40 rounded-sm backdrop-blur-sm"
        style={{ fontFamily: "var(--font-audiowide)" }}
      >
        <span className="text-3xl">{meta.icon}</span>
        <span className="text-sm tracking-[0.2em] uppercase neon-text-cyan">
          {meta.label}
        </span>
      </div>
    </div>
  );
}

type GestureProgressBarProps = {
  /** 0-1 progress, or 0 when not active */
  progress: number;
  /** Which gesture is pending, for color coding */
  pending: GestureAction | null;
};

export function GestureProgressBar({ progress, pending }: GestureProgressBarProps) {
  if (!pending || progress <= 0) return null;

  const color =
    pending === "restart"
      ? "linear-gradient(90deg, #ff4444, #ff8800)"
      : "linear-gradient(90deg, #00ffcc, #00aaff)";

  return (
    <div className="absolute top-0 left-0 right-0 h-1.5 z-30 pointer-events-none">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(progress * 100, 100)}%`,
          background: color,
          boxShadow: `0 0 8px ${pending === "restart" ? "rgba(255,68,68,0.5)" : "rgba(0,255,204,0.5)"}`,
          transition: "width 0.1s linear",
        }}
      />
    </div>
  );
}
