"use client";

import { useState, useEffect, useRef } from "react";

const HISTORY_KEY = "urlHistory:v2";
const MAX_HISTORY = 3;

type HistoryEntry = { url: string; title: string };

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          typeof e === "object" && e !== null && typeof e.url === "string"
      )
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function pushHistory(url: string, title?: string) {
  const history = readHistory().filter((e) => e.url !== url);
  history.unshift({ url, title: title ?? "" });
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

function updateHistoryTitle(url: string, title: string) {
  const history = readHistory();
  const entry = history.find((e) => e.url === url);
  if (entry) {
    entry.title = title;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }
}

type Props = {
  onSubmit: (url: string) => void;
  initialUrl?: string;
  /** Title resolved after download (from SSE classified event). Updates history. */
  lastSubmittedTitle?: string;
  /** URL that lastSubmittedTitle corresponds to. */
  lastSubmittedUrl?: string;
};

export default function UrlInput({ onSubmit, initialUrl = "", lastSubmittedTitle, lastSubmittedUrl }: Props) {
  const [value, setValue] = useState(initialUrl);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  // When a title is resolved after download, update the matching history entry
  useEffect(() => {
    if (lastSubmittedTitle && lastSubmittedUrl) {
      updateHistoryTitle(lastSubmittedUrl, lastSubmittedTitle);
      setHistory(readHistory());
    }
  }, [lastSubmittedTitle, lastSubmittedUrl]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    pushHistory(trimmed);
    setHistory(readHistory());
    setOpen(false);
    onSubmit(trimmed);
  };

  const handlePick = (entry: HistoryEntry) => {
    setValue(entry.url);
    setOpen(false);
    pushHistory(entry.url, entry.title);
    setHistory(readHistory());
    onSubmit(entry.url);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full max-w-2xl mx-auto items-center">
      <div className="flex-1 relative" ref={wrapperRef}>
        <span
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] tracking-widest uppercase text-neon-cyan/35"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          URL
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => history.length > 0 && setOpen(true)}
          placeholder="paste youtube url..."
          className="neon-input w-full pl-14 pr-4 py-2.5 rounded-none text-sm tracking-wide"
          style={{ fontFamily: "var(--font-chakra-petch)" }}
        />
        {open && history.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 z-50 border border-neon-cyan/20 bg-[#0a0a1a]/95 backdrop-blur-md">
            {history.map((entry) => (
              <li key={entry.url}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handlePick(entry);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-neon-cyan/10 transition-colors truncate"
                  style={{ fontFamily: "var(--font-chakra-petch)" }}
                >
                  <span className="block text-xs tracking-wide text-neon-cyan/90 truncate">
                    {entry.title || entry.url}
                  </span>
                  {entry.title && (
                    <span className="block text-[10px] text-neon-cyan/40 truncate mt-0.5">
                      {entry.url}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="submit"
        className="neon-btn px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.15em] rounded-none"
        style={{ fontFamily: "var(--font-audiowide)" }}
      >
        Load
      </button>
    </form>
  );
}
