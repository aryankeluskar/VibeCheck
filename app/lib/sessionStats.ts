/**
 * Module-level accumulator for session performance stats.
 * Same pattern as gestureControl.ts — no React state, no re-renders.
 * Call recordXxx() from the scoring hot path, then getSessionStats() at the end.
 */

export type ScoreType = "perfect" | "great" | "ok" | "almost" | "miss";

export type SessionStats = {
  scoreTimeline: number[];
  limbTotals: Record<string, { sum: number; count: number }>;
  frameHits: Record<ScoreType, number>;
  peakScore: number;
  totalFrames: number;
  sessionDurationMs: number;
};

// --- Module-level accumulators ---
let scoreTimeline: number[] = [];
let limbTotals: Record<string, { sum: number; count: number }> = {};
let frameHits: Record<ScoreType, number> = {
  perfect: 0,
  great: 0,
  ok: 0,
  almost: 0,
  miss: 0,
};
let peakScore = 0;
let lastSampleTime = 0;

const SAMPLE_INTERVAL_MS = 500;

export function resetSessionStats(): void {
  scoreTimeline = [];
  limbTotals = {};
  frameHits = { perfect: 0, great: 0, ok: 0, almost: 0, miss: 0 };
  peakScore = 0;
  lastSampleTime = 0;
}

/** Throttled to one sample per 500ms. */
export function recordScoreSample(smoothedScore: number): void {
  const now = performance.now();
  if (now - lastSampleTime < SAMPLE_INTERVAL_MS) return;
  lastSampleTime = now;
  scoreTimeline.push(Math.round(smoothedScore));
  if (smoothedScore > peakScore) peakScore = Math.round(smoothedScore);
}

/** Accumulate per-limb scores (called every frame that has a detailed comparison). */
export function recordLimbScores(limbScores: Record<string, number>): void {
  for (const [limb, score] of Object.entries(limbScores)) {
    if (!limbTotals[limb]) limbTotals[limb] = { sum: 0, count: 0 };
    limbTotals[limb].sum += score;
    limbTotals[limb].count += 1;
  }
}

/** Increment the frame-hit counter for a score type. */
export function recordFrameHit(scoreType: ScoreType): void {
  frameHits[scoreType] += 1;
}

/** Return a snapshot of the accumulated stats. */
export function getSessionStats(
  totalFrames: number,
  sessionDurationMs: number,
): SessionStats {
  return {
    scoreTimeline: [...scoreTimeline],
    limbTotals: JSON.parse(JSON.stringify(limbTotals)),
    frameHits: { ...frameHits },
    peakScore,
    totalFrames,
    sessionDurationMs,
  };
}
