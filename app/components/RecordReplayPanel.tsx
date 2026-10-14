"use client";

import { useRef } from "react";
import type { StripPoseTimeline } from "../lib/videoPoseExtractor";

type Props = {
  videoId: string | null;
  poseTimeline: StripPoseTimeline | null;
  isReplaying: boolean;
  isPaused: boolean;
  replayProgress: number;
  onStartRecord: () => void;
  onStopRecord: () => void;
  onLoadRecording: (file: File) => void;
  onStartReplay: () => void;
  onPauseReplay: () => void;
  onResumeReplay: () => void;
  onStopReplay: () => void;
};

export default function RecordReplayPanel({
  videoId,
  poseTimeline,
  isReplaying,
  isPaused,
  replayProgress,
  onStartRecord,
  onStopRecord,
  onLoadRecording,
  onStartReplay,
  onPauseReplay,
  onResumeReplay,
  onStopReplay,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingRef = useRef(false);
  const hasLoadedRef = useRef(false);

  // Only visible when video is loaded and poses are extracted
  if (!videoId || !poseTimeline) return null;

  const handleRecordToggle = () => {
    if (recordingRef.current) {
      recordingRef.current = false;
      onStopRecord();
    } else {
      recordingRef.current = true;
      onStartRecord();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      hasLoadedRef.current = true;
      onLoadRecording(file);
    }
    // Reset so same file can be reloaded
    e.target.value = "";
  };

  const btnBase =
    "px-2.5 py-1.5 text-[10px] tracking-[0.15em] uppercase border rounded transition-all duration-200";
  const fontStyle = { fontFamily: "var(--font-audiowide)" };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Progress bar — shown during replay */}
      {isReplaying && (
        <div className="w-64 flex items-center gap-2">
          <div className="flex-1 h-1 bg-black/50 rounded overflow-hidden border border-neon-cyan/20">
            <div
              className="h-full bg-neon-cyan/70 transition-all duration-100"
              style={{ width: `${replayProgress}%` }}
            />
          </div>
          <span
            className="text-[9px] text-neon-cyan/60 font-mono min-w-[40px] text-right"
            style={fontStyle}
          >
            {Math.round(replayProgress)}%
          </span>
        </div>
      )}

      {/* Controls toolbar */}
      <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm border border-neon-cyan/20 rounded-lg px-2.5 py-2">
        {/* Record / Stop recording */}
        <button
          onClick={handleRecordToggle}
          disabled={isReplaying}
          className={`${btnBase} ${
            recordingRef.current
              ? "border-red-500/60 text-red-400 bg-red-500/10 hover:bg-red-500/20"
              : "border-red-500/30 text-red-400/70 hover:border-red-500/50 hover:bg-red-500/10"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
          style={fontStyle}
          title={recordingRef.current ? "Stop recording" : "Start recording"}
        >
          {recordingRef.current ? "\u25A0 Stop" : "\u25CF Rec"}
        </button>

        {/* Load recording */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isReplaying}
          className={`${btnBase} border-neon-cyan/30 text-neon-cyan/70 hover:border-neon-cyan/50 hover:bg-neon-cyan/10 disabled:opacity-30 disabled:cursor-not-allowed`}
          style={fontStyle}
          title="Load recording"
        >
          Load
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Divider */}
        {hasLoadedRef.current && (
          <div className="w-px h-5 bg-neon-cyan/20 mx-1" />
        )}

        {/* Replay controls — shown after a recording is loaded */}
        {hasLoadedRef.current && !isReplaying && (
          <button
            onClick={onStartReplay}
            className={`${btnBase} border-green-500/30 text-green-400/70 hover:border-green-500/50 hover:bg-green-500/10`}
            style={fontStyle}
            title="Play replay"
          >
            &#9654; Play
          </button>
        )}

        {isReplaying && (
          <>
            <button
              onClick={isPaused ? onResumeReplay : onPauseReplay}
              className={`${btnBase} border-yellow-500/30 text-yellow-400/70 hover:border-yellow-500/50 hover:bg-yellow-500/10`}
              style={fontStyle}
              title={isPaused ? "Resume" : "Pause"}
            >
              {isPaused ? "\u25B6 Resume" : "\u275A\u275A Pause"}
            </button>
            <button
              onClick={onStopReplay}
              className={`${btnBase} border-neon-cyan/30 text-neon-cyan/70 hover:border-neon-cyan/50 hover:bg-neon-cyan/10`}
              style={fontStyle}
              title="Stop replay"
            >
              &#9632; Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
