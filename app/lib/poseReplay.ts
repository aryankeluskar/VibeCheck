import type { NormalizedLandmark } from "./pose";
import type { PoseRecording } from "./poseRecorder";

export type ReplayOptions = {
  recording: PoseRecording;
  onFrame: (landmarks: NormalizedLandmark[], videoTime: number) => void;
  seekVideo: (time: number) => void;
  onComplete: () => void;
  onProgress: (frameIndex: number, totalFrames: number) => void;
};

// --- Module-level state ---
let replaying = false;
let paused = false;
let rafId: number | null = null;
let frameIndex = 0;
let replayStart = 0;
let pausedElapsed = 0;
let lastSeekTime = -1;
let opts: ReplayOptions | null = null;

export function startReplay(options: ReplayOptions): void {
  stopReplay();
  opts = options;
  frameIndex = 0;
  paused = false;
  pausedElapsed = 0;
  lastSeekTime = -1;
  replaying = true;
  replayStart = performance.now();

  // Seek to the first frame's video time
  if (opts.recording.frames.length > 0) {
    const firstVt = opts.recording.frames[0].vt;
    opts.seekVideo(firstVt);
    lastSeekTime = firstVt;
  }

  rafId = requestAnimationFrame(tick);
}

function tick(): void {
  if (!replaying || paused || !opts) return;

  const elapsed = performance.now() - replayStart;
  const frames = opts.recording.frames;
  const total = frames.length;

  // Dispatch all frames with t <= elapsed that haven't been dispatched yet
  while (frameIndex < total && frames[frameIndex].t <= elapsed) {
    const frame = frames[frameIndex];

    // Seek video only when delta > 0.1s to avoid jitter
    if (Math.abs(frame.vt - lastSeekTime) > 0.1) {
      opts.seekVideo(frame.vt);
      lastSeekTime = frame.vt;
    }

    opts.onFrame(frame.lm, frame.vt);
    opts.onProgress(frameIndex, total);
    frameIndex++;
  }

  if (frameIndex >= total) {
    opts.onProgress(total, total);
    opts.onComplete();
    replaying = false;
    opts = null;
    rafId = null;
    return;
  }

  rafId = requestAnimationFrame(tick);
}

export function pauseReplay(): void {
  if (!replaying || paused) return;
  paused = true;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pausedElapsed = performance.now() - replayStart;
}

export function resumeReplay(): void {
  if (!replaying || !paused) return;
  paused = false;
  replayStart = performance.now() - pausedElapsed;
  rafId = requestAnimationFrame(tick);
}

export function stopReplay(): void {
  replaying = false;
  paused = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  frameIndex = 0;
  opts = null;
}

export function isReplaying(): boolean {
  return replaying;
}
