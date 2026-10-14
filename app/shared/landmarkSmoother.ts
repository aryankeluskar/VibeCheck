/**
 * Light landmark stabilizer — applies gentle EMA (Exponential Moving Average)
 * to reduce small jitter in MediaPipe Pose landmarks without rejecting frames.
 */

import type { NormalizedLandmark } from "./pose";

const DEFAULT_ALPHA = 0.7; // High alpha = very responsive, slight smoothing

export class LandmarkSmoother {
  private prev: NormalizedLandmark[] | null = null;
  private alpha: number;

  constructor(alpha = DEFAULT_ALPHA) {
    this.alpha = alpha;
  }

  /** Lightly smooth incoming landmarks. Never rejects frames. */
  smooth(raw: NormalizedLandmark[]): NormalizedLandmark[] {
    if (!this.prev) {
      this.prev = raw.map((lm) => ({ ...lm }));
      return this.prev;
    }

    const smoothed: NormalizedLandmark[] = raw.map((lm, i) => {
      const prev = this.prev![i];
      if (!prev || (lm.visibility ?? 0) < 0.15) return { ...lm };

      return {
        x: prev.x + this.alpha * (lm.x - prev.x),
        y: prev.y + this.alpha * (lm.y - prev.y),
        z: prev.z + this.alpha * (lm.z - prev.z),
        visibility: lm.visibility,
      };
    });

    this.prev = smoothed.map((lm) => ({ ...lm }));
    return smoothed;
  }

  reset() {
    this.prev = null;
  }
}
