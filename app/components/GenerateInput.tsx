"use client";

import { useState } from "react";

const EXAMPLES = [
  "5-min core blast workout",
  "Upper body HIIT routine",
  "Yoga sun salutation flow",
];

type Props = {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
};

export default function GenerateInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  };

  const handleChip = (example: string) => {
    if (disabled) return;
    setValue(example);
    onSubmit(example);
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <div className="flex-1 relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] tracking-widest uppercase text-neon-cyan/35"
            style={{ fontFamily: "var(--font-audiowide)" }}
          >
            AI
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="describe your workout or dance..."
            disabled={disabled}
            className="neon-input w-full pl-12 pr-4 py-2.5 rounded-none text-sm tracking-wide disabled:opacity-50"
            style={{ fontFamily: "var(--font-chakra-petch)" }}
          />
        </div>
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="neon-btn px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.15em] rounded-none disabled:opacity-50"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          Generate
        </button>
      </form>
      <div className="flex flex-wrap gap-2 mt-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => handleChip(ex)}
            disabled={disabled}
            className="px-3 py-1 text-[11px] tracking-wide border border-neon-cyan/20 text-neon-cyan/60 hover:bg-neon-cyan/10 hover:text-neon-cyan transition-colors disabled:opacity-30"
            style={{ fontFamily: "var(--font-chakra-petch)" }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
