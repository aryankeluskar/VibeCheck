"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

type LibraryVideo = { id: string; title: string; mode: "dance" | "gym"; source: string };

type Props = {
  onSelect: (id: string) => void;
  activeId: string | null;
  disabled?: boolean;
};

const AUDIOWIDE = { fontFamily: "var(--font-audiowide)" } as const;

function newUploadId() {
  return `up_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Shared reference-video library (Vercel Blob) plus upload-your-own. */
export default function LibraryInput({ onSelect, activeId, disabled }: Props) {
  const [videos, setVideos] = useState<LibraryVideo[] | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/library", { cache: "no-store" });
      const data = await res.json();
      setVideos(data.videos ?? []);
    } catch {
      setVideos([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, activeId]);

  const handleFile = async (file: File) => {
    setError(null);
    setUploadPct(0);
    const id = newUploadId();
    try {
      await upload(`videos/${id}.mp4`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        contentType: file.type || "video/mp4",
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setUploadPct(percentage),
      });
      const title = file.name.replace(/\.[^.]+$/, "");
      const mode = /work ?out|fitness|gym|squat|yoga|stretch|hiit|exercise/i.test(title) ? "gym" : "dance";
      await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title, mode }),
      });
      setUploadPct(null);
      await refresh();
      onSelect(id);
    } catch (err) {
      setUploadPct(null);
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5 overflow-x-auto pb-1 items-center">
        {videos === null && (
          <span className="text-[10px] text-neon-cyan/40 tracking-wider uppercase px-2">Loading library…</span>
        )}
        {videos?.length === 0 && (
          <span className="text-[10px] text-neon-cyan/40 tracking-wider uppercase px-2">
            Library is empty. Upload a clip or paste a YouTube URL.
          </span>
        )}
        {videos?.map((v) => (
          <button
            key={v.id}
            disabled={disabled}
            onClick={() => onSelect(v.id)}
            title={v.title}
            className={`shrink-0 max-w-[220px] truncate px-3 py-1.5 text-[11px] border rounded-sm transition-colors disabled:opacity-40 ${
              activeId === v.id
                ? "border-neon-cyan/70 text-neon-cyan bg-neon-cyan/10"
                : "border-neon-cyan/20 text-white/70 hover:border-neon-cyan/50 hover:text-white"
            }`}
          >
            <span className="opacity-50 mr-1.5">{v.mode === "gym" ? "GYM" : "DANCE"}</span>
            {v.title || v.id}
          </button>
        ))}
        <button
          disabled={disabled || uploadPct !== null}
          onClick={() => fileRef.current?.click()}
          className="shrink-0 px-3 py-1.5 text-[10px] tracking-[0.2em] uppercase border border-neon-magenta/40 text-neon-magenta/80 hover:bg-neon-magenta/10 rounded-sm disabled:opacity-40"
          style={AUDIOWIDE}
        >
          {uploadPct !== null ? `Uploading ${Math.round(uploadPct)}%` : "+ Upload clip"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) handleFile(f);
          }}
        />
      </div>
      {error && <p className="text-[10px] text-neon-red/70">{error}</p>}
    </div>
  );
}
