"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { captureVideoFrame } from "../lib/frameCapture";

type DownloadStatus = "idle" | "downloading" | "done" | "error";
type ExtractionStatus = "idle" | "extracting" | "done";
type SegmentationStatus = "idle" | "segmenting" | "done" | "error" | "unavailable";

export type YoutubePanelHandle = {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  isPaused: () => boolean;
  getVideoAspectRatio: () => number;
  captureFrame: () => string | null;
  togglePlayPause: () => void;
};

type Props = {
  videoId: string | null;
  downloadStatus: DownloadStatus;
  downloadProgress: number;
  downloadError: string | null;
  extractionStatus: ExtractionStatus;
  extractionProgress: number;
  segmentationStatus?: SegmentationStatus;
  segmentationProgress?: number;
  generatePhase?: string;
};

function HudCorners({ color = "neon-cyan" }: { color?: string }) {
  const c = `border-${color}/50`;
  return (
    <>
      <div className={`absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 ${c} z-10`} />
      <div className={`absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 ${c} z-10`} />
      <div className={`absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 ${c} z-10`} />
      <div className={`absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 ${c} z-10`} />
    </>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute top-2 left-3 z-10 text-[8px] tracking-[0.3em] uppercase text-neon-cyan/35"
      style={{ fontFamily: "var(--font-audiowide)" }}
    >
      {children}
    </div>
  );
}

const YoutubePanel = forwardRef<YoutubePanelHandle, Props>(function YoutubePanel(
  {
    videoId,
    downloadStatus,
    downloadProgress,
    downloadError,
    extractionStatus,
    extractionProgress,
    segmentationStatus,
    segmentationProgress,
    generatePhase,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => videoRef.current?.duration ?? 0,
    seekTo: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = time;
    },
    setPlaybackRate: (rate: number) => {
      if (videoRef.current) videoRef.current.playbackRate = rate;
    },
    isPaused: () => videoRef.current?.paused ?? true,
    getVideoAspectRatio: () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) return 16/9;
      return video.videoWidth / video.videoHeight;
    },
    captureFrame: () =>
      videoRef.current ? captureVideoFrame(videoRef.current, false) : null,
    togglePlayPause: () => {
      const v = videoRef.current;
      if (!v) return;
      v.paused ? v.play() : v.pause();
    },
  }));

  if (!videoId || downloadStatus === "idle") {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-black/50 border border-neon-cyan/10 rounded animate-border-breathe">
        <HudCorners />
        <PanelLabel>Reference</PanelLabel>
        <div className="text-center">
          <div
            className="neon-text-cyan text-[40px] mb-3 opacity-20"
            style={{ fontFamily: "var(--font-audiowide)" }}
          >
            &#9654;
          </div>
          <p className="text-neon-cyan/25 text-xs tracking-wider uppercase">
            Paste a YouTube URL or generate with AI
          </p>
        </div>
      </div>
    );
  }

  if (downloadStatus === "downloading") {
    const phaseLabel = generatePhase
      ? { researching: "Researching the Web", synthesizing: "Synthesizing Routine", generating: "Generating Video", downloading: "Downloading Video" }[generatePhase] || "Processing"
      : "Downloading";

    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-5 bg-black/50 border border-neon-cyan/10 rounded">
        <HudCorners />
        <PanelLabel>{generatePhase ? "AI Generating" : "Downloading"}</PanelLabel>
        <div
          className="text-neon-cyan/50 text-xs tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {phaseLabel}
        </div>
        <div className="w-56 h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full neon-progress transition-all duration-300"
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
        <div
          className="neon-text-cyan text-2xl font-bold"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {Math.round(downloadProgress)}%
        </div>
      </div>
    );
  }

  if (downloadStatus === "error") {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-3 bg-black/50 border border-neon-red/20 rounded">
        <HudCorners color="neon-red" />
        <div
          className="neon-text-red text-xs tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          Error
        </div>
        <p className="text-neon-red/50 text-xs max-w-xs text-center">
          {downloadError || "Unknown error"}
        </p>
      </div>
    );
  }

  // Show loading screens while extraction or segmentation are in progress
  const segmentationPending =
    segmentationStatus === "idle" ||
    segmentationStatus === "segmenting";
  const segmentationReady =
    segmentationStatus === "done" ||
    segmentationStatus === "error" ||
    segmentationStatus === "unavailable";

  if (extractionStatus === "extracting" || (!segmentationReady && downloadStatus === "done")) {
    // Both extraction and segmentation may run in parallel — show dual progress
    const showExtraction = extractionStatus === "extracting";
    const showSegmentation = segmentationPending && downloadStatus === "done";

    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-6 bg-black/50 border border-neon-violet/15 rounded">
        <HudCorners color="neon-violet" />
        <PanelLabel>Preparing</PanelLabel>

        <div
          className="neon-text-violet text-xs tracking-[0.2em] uppercase"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          Preparing Your Dance
        </div>

        {/* Extraction progress */}
        <div className="w-64 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span
              className="text-[9px] tracking-[0.15em] uppercase"
              style={{
                fontFamily: "var(--font-audiowide)",
                color: showExtraction ? "rgba(184, 41, 255, 0.8)" : "rgba(184, 41, 255, 0.35)",
              }}
            >
              Analyzing Moves
            </span>
            <span
              className="text-[9px] tracking-[0.15em]"
              style={{
                fontFamily: "var(--font-audiowide)",
                color: showExtraction ? "rgba(184, 41, 255, 0.8)" : "rgba(184, 41, 255, 0.35)",
              }}
            >
              {extractionStatus === "done" ? "✓" : `${Math.round(extractionProgress)}%`}
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${extractionStatus === "done" ? 100 : extractionProgress}%`,
                background: "linear-gradient(90deg, #b829ff, #ff00aa)",
                boxShadow: showExtraction ? "0 0 10px rgba(184, 41, 255, 0.4)" : "none",
                opacity: extractionStatus === "done" ? 0.4 : 1,
              }}
            />
          </div>
        </div>

        {/* Segmentation progress */}
        {showSegmentation && (
          <div className="w-64 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span
                className="text-[9px] tracking-[0.15em] uppercase text-neon-green/80"
                style={{ fontFamily: "var(--font-audiowide)" }}
              >
                Segmenting Dancer
              </span>
              <span
                className="text-[9px] tracking-[0.15em] text-neon-green/80"
                style={{ fontFamily: "var(--font-audiowide)" }}
              >
                {(segmentationProgress ?? 0) > 0
                  ? `${Math.round(segmentationProgress ?? 0)}%`
                  : "Starting..."}
              </span>
            </div>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${segmentationProgress ?? 0}%`,
                  background: "linear-gradient(90deg, #00ff88, #00ccff)",
                  boxShadow: "0 0 10px rgba(0, 255, 136, 0.3)",
                }}
              />
            </div>
          </div>
        )}

        {/* Overall percentage */}
        <div
          className="neon-text-violet text-2xl font-bold"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          {Math.round(
            showExtraction && showSegmentation
              ? (extractionProgress + (segmentationProgress ?? 0)) / 2
              : showExtraction
                ? extractionProgress
                : (segmentationProgress ?? 0)
          )}%
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full rounded overflow-hidden border border-neon-cyan/15 bg-black glow-cyan">
      <HudCorners />
      <PanelLabel>Reference</PanelLabel>
      <video
        ref={videoRef}
        src={`/api/video/${videoId}`}
        controls
        autoPlay
        className="absolute inset-0 w-full h-full object-contain"
      />

      {segmentationStatus === "done" && (
        <div className="absolute bottom-2 right-3 z-10 flex items-center gap-2 bg-black/80 px-2.5 py-1 border border-neon-green/30 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-green" />
          <span
            className="text-[9px] tracking-[0.15em] text-neon-green/80 uppercase"
            style={{ fontFamily: "var(--font-audiowide)" }}
          >
            Segmented
          </span>
        </div>
      )}
    </div>
  );
});

export default YoutubePanel;
