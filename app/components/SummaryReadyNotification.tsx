"use client";

import { useEffect, useState } from "react";

type Props = {
  visible: boolean;
  onView: () => void;
  onDismiss: () => void;
};

export default function SummaryReadyNotification({ visible, onView, onDismiss }: Props) {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (visible) {
      // Trigger animation after mount
      setTimeout(() => setIsAnimating(true), 50);
    } else {
      setIsAnimating(false);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 transition-all duration-500 ${
        isAnimating ? "translate-x-0 opacity-100" : "translate-x-[120%] opacity-0"
      }`}
    >
      <div
        className="relative bg-black/80 backdrop-blur-md border border-neon-cyan/30 rounded-lg px-5 py-4 shadow-2xl"
        style={{
          boxShadow: "0 0 30px rgba(0, 255, 255, 0.3), 0 10px 40px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Subtle glow effect */}
        <div
          className="absolute inset-0 rounded-lg opacity-20 animate-pulse pointer-events-none"
          style={{
            background: "radial-gradient(circle at 50% 50%, rgba(0, 255, 255, 0.4), transparent)",
          }}
        />

        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 text-neon-cyan/40 hover:text-neon-cyan/80 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="relative flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {/* Icon */}
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-neon-cyan animate-pulse"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="flex-1">
              <h3
                className="text-sm tracking-[0.15em] uppercase text-neon-cyan font-semibold"
                style={{ fontFamily: "var(--font-audiowide)" }}
              >
                Summary Ready!
              </h3>
              <p className="text-xs text-neon-cyan/60 mt-0.5">Your performance report is available</p>
            </div>
          </div>

          {/* View button */}
          <button
            onClick={onView}
            className="w-full px-4 py-2 bg-neon-cyan/10 border border-neon-cyan/40 rounded text-neon-cyan hover:bg-neon-cyan/20 hover:border-neon-cyan/60 transition-all duration-200 text-sm tracking-[0.2em] uppercase font-semibold"
            style={{ fontFamily: "var(--font-audiowide)" }}
          >
            View Report
          </button>
        </div>
      </div>
    </div>
  );
}
