/**
 * Gym-tuned scoring module for fitness/workout pose evaluation.
 * Mirrors the structure of scoring.ts but with gym-appropriate heuristics:
 * - Stillness is not penalized (holds/planks are valid)
 * - Controlled movement is rewarded
 * - Chaotic movement is heavily penalized (form breakdown)
 * - Torso lean is strictly penalized (posture critical)
 * - Knee bend is scored for squat depth
 */

import type { NormalizedLandmark } from "./pose";
import type { ScoreFrame, PoseSummary } from "./scoring";

const HISTORY_SIZE = 15;
let history: NormalizedLandmark[][] = [];
let scoreHistory: number[] = [];
let sessionStart = 0;

export function resetGymScoring(): void {
  history = [];
  scoreHistory = [];
  sessionStart = 0;
}

export function computeGymScore(
  landmarks: NormalizedLandmark[] | null
): ScoreFrame {
  const now = Date.now();

  if (!landmarks || landmarks.length === 0) {
    history = [];
    return { ts: now, score: 0, issues: ["No pose detected"] };
  }

  const issues: string[] = [];
  let score = 70;

  const avgVisibility =
    landmarks.reduce((s, l) => s + (l.visibility ?? 0), 0) / landmarks.length;
  if (avgVisibility < 0.5) {
    score -= 15;
    issues.push("Low pose confidence");
  }

  // Arm symmetry (stricter for gym)
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
    const armDiff = Math.abs(leftWrist.y - rightWrist.y);
    if (armDiff > 0.18) {
      score -= 10;
      issues.push("Arms uneven");
    }
  }

  // Torso lean (critical for gym — posture is everything)
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  if (lShoulder && rShoulder && lHip && rHip) {
    const shoulderCX = (lShoulder.x + rShoulder.x) / 2;
    const hipCX = (lHip.x + rHip.x) / 2;
    const lean = Math.abs(hipCX - shoulderCX);
    if (lean > 0.05) {
      score -= 12;
      issues.push("Fix your posture");
    }
  }

  // Knee bend — reward depth for squats
  const lKnee = landmarks[25];
  const rKnee = landmarks[26];
  if (lHip && rHip && lKnee && rKnee) {
    const kneeBend = ((lKnee.y - lHip.y) + (rKnee.y - rHip.y)) / 2;
    if (kneeBend > 0.15) {
      score += 5; // Reward good squat depth
    }
  }

  history.push(landmarks);
  if (history.length > HISTORY_SIZE) history.shift();

  if (history.length >= 3) {
    const prev = history[history.length - 3];
    const curr = history[history.length - 1];
    let totalDisp = 0;
    const count = Math.min(prev.length, curr.length);
    for (let i = 0; i < count; i++) {
      const dx = curr[i].x - prev[i].x;
      const dy = curr[i].y - prev[i].y;
      totalDisp += Math.sqrt(dx * dx + dy * dy);
    }
    const avgDisp = totalDisp / count;

    if (avgDisp < 0.008) {
      // Stillness — no penalty for gym (holds are valid)
      score += 3;
    } else if (avgDisp < 0.02) {
      // Controlled movement — bonus
      score += 5;
    } else if (avgDisp > 0.12) {
      // Chaotic — heavy penalty for gym (form breakdown)
      score -= 15;
      issues.push("Control the movement");
    } else {
      score += 8;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const rounded = Math.round(score);

  scoreHistory.push(rounded);
  if (scoreHistory.length > 30) scoreHistory.shift();

  return { ts: now, score: rounded, issues };
}

export function buildGymPoseSummary(
  landmarks: NormalizedLandmark[] | null,
  frame: ScoreFrame
): PoseSummary {
  if (!sessionStart) sessionStart = Date.now();

  const fallback: PoseSummary = {
    score: frame.score,
    confidence: 0,
    body: {
      armHeight: 0,
      armSymmetry: 0,
      motionEnergy: 0,
      torsoLean: 0,
      kneeBend: 0,
    },
    issues: frame.issues,
    trend: computeGymTrend(),
    sessionSeconds: Math.round((Date.now() - sessionStart) / 1000),
  };

  if (!landmarks || landmarks.length < 33) return fallback;

  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lWrist = landmarks[15];
  const rWrist = landmarks[16];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  const lKnee = landmarks[25];
  const rKnee = landmarks[26];

  const avgVisibility =
    landmarks.reduce((s, l) => s + (l.visibility ?? 0), 0) / landmarks.length;

  const avgShoulderY = (lShoulder.y + rShoulder.y) / 2;
  const avgWristY = (lWrist.y + rWrist.y) / 2;
  const armHeight = round(avgWristY - avgShoulderY);
  const armSymmetry = round(Math.abs(lWrist.y - rWrist.y));

  let motionEnergy = 0;
  if (history.length >= 3) {
    const prev = history[history.length - 3];
    const curr = history[history.length - 1];
    let totalDisp = 0;
    const count = Math.min(prev.length, curr.length);
    for (let i = 0; i < count; i++) {
      const dx = curr[i].x - prev[i].x;
      const dy = curr[i].y - prev[i].y;
      totalDisp += Math.sqrt(dx * dx + dy * dy);
    }
    motionEnergy = round(totalDisp / count);
  }

  const shoulderCX = (lShoulder.x + rShoulder.x) / 2;
  const hipCX = (lHip.x + rHip.x) / 2;
  const torsoLean = round(hipCX - shoulderCX);

  const kneeBend = round(
    ((lKnee.y - lHip.y) + (rKnee.y - rHip.y)) / 2
  );

  return {
    score: frame.score,
    confidence: round(avgVisibility),
    body: { armHeight, armSymmetry, motionEnergy, torsoLean, kneeBend },
    issues: frame.issues,
    trend: computeGymTrend(),
    sessionSeconds: Math.round((Date.now() - sessionStart) / 1000),
  };
}

function computeGymTrend(): "improving" | "declining" | "steady" {
  if (scoreHistory.length < 10) return "steady";
  const recent = scoreHistory.slice(-5);
  const older = scoreHistory.slice(-10, -5);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const diff = recentAvg - olderAvg;
  if (diff > 5) return "improving";
  if (diff < -5) return "declining";
  return "steady";
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
