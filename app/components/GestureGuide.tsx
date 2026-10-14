"use client";

import { useState } from "react";

const GESTURES = [
  {
    icon: "\u{1F44B}",
    key: "play_pause",
    label: "Play / Pause",
    desc: "Flick wrist side-to-side above shoulder",
  },
  {
    icon: "\u{1F449}",
    key: "skip",
    label: "Skip \u00B15s",
    desc: "Left hand above shoulder, swipe L/R",
  },
  {
    icon: "\u{1F64C}",
    key: "restart",
    label: "Restart",
    desc: "Both hands above head, hold 2s",
  },
] as const;

type Props = {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
};

export default function GestureGuide({ enabled, onToggle }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute bottom-2 left-3 z-20">
      {/* Expanded panel */}
      {open && (
        <div
          className="mb-2 w-64 bg-black/90 border border-neon-cyan/30 rounded-sm backdrop-blur-sm overflow-hidden"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          <div className="px-3 py-2.5 border-b border-neon-cyan/15 flex items-center justify-between">
            <span className="text-[11px] tracking-[0.25em] uppercase neon-text-cyan opacity-80">
              Gesture Controls
            </span>
            <button
              onClick={() => onToggle(!enabled)}
              className={`text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 rounded-sm border transition-colors ${
                enabled
                  ? "border-green-500/40 text-green-400/80 bg-green-500/10 hover:bg-green-500/20"
                  : "border-red-500/40 text-red-400/80 bg-red-500/10 hover:bg-red-500/20"
              }`}
            >
              {enabled ? "On" : "Off"}
            </button>
          </div>
          <div className={`flex flex-col gap-0${enabled ? "" : " opacity-40"}`}>
            {GESTURES.map((g) => (
              <div
                key={g.key}
                className="flex items-start gap-3 px-3 py-2.5 border-b border-white/5 last:border-b-0"
              >
                <span className="text-lg flex-shrink-0 mt-0.5 leading-none">{g.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11px] tracking-[0.15em] uppercase text-white/90 leading-tight">
                    {g.label}
                  </p>
                  <p className="text-[10px] tracking-[0.1em] text-white/50 leading-tight mt-1">
                    {g.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-neon-cyan/15">
            <p className="text-[9px] tracking-[0.1em] text-white/40 leading-tight">
              Hold still to trigger &middot; 2s cooldown between gestures
            </p>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-3 py-1.5 bg-black/80 border rounded-sm transition-colors ${
          enabled
            ? "border-neon-cyan/30 text-white/70 hover:text-white/90 hover:border-neon-cyan/50"
            : "border-white/15 text-white/40 hover:text-white/60 hover:border-white/30"
        }`}
        title={open ? "Hide gesture controls" : "Show gesture controls"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
        >
          <path d="M18 11V6a2 2 0 0 0-4 0" />
          <path d="M14 10V4a2 2 0 0 0-4 0v6" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
        <span
          className="text-[10px] tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {open ? "Hide" : enabled ? "Gestures" : "Gestures Off"}
        </span>
      </button>
    </div>
  );
}
