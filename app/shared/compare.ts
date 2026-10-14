/**
 * Pose comparison module.
 * Compares two sets of pose landmarks (reference dancer vs user)
 * and produces a similarity score + per-body-part feedback.
 */

import type { NormalizedLandmark } from "./pose";


export type ComparisonResult = {
  /** Overall similarity 0-100 (100 = perfect match) */
  similarity: number;
  /** Per-body-part scores */
  parts: {
    arms: number;
    legs: number;
    torso: number;
  };
  /** Specific feedback on what to fix */
  feedback: string[];
};

/**
 * Key landmark indices for comparison.
 * We use body landmarks (11-32), skipping face/hands for robustness.
 *
 * 11/12 = shoulders, 13/14 = elbows, 15/16 = wrists
 * 23/24 = hips, 25/26 = knees, 27/28 = ankles
 */
const ARM_INDICES = [11, 12, 13, 14, 15, 16];
const LEG_INDICES = [23, 24, 25, 26, 27, 28];
const TORSO_INDICES = [11, 12, 23, 24];

/**
 * Compute how well the user's pose matches the reference pose.
 *
 * Uses normalised joint angles rather than absolute positions,
 * so it works regardless of distance from camera or body size.
 */
export function comparePoses(
  reference: NormalizedLandmark[] | null,
  user: NormalizedLandmark[] | null
): ComparisonResult {
  const noResult: ComparisonResult = {
    similarity: 0,
    parts: { arms: 0, legs: 0, torso: 0 },
    feedback: ["Waiting for both poses…"],
  };

  if (!reference || !user || reference.length < 33 || user.length < 33) {
    return noResult;
  }

  // Check visibility — need decent detection on both sides
  const refVis = avgVisibility(reference, [...ARM_INDICES, ...LEG_INDICES, ...TORSO_INDICES]);
  const userVis = avgVisibility(user, [...ARM_INDICES, ...LEG_INDICES, ...TORSO_INDICES]);
  if (refVis < 0.3 || userVis < 0.3) {
    return {
      similarity: 0,
      parts: { arms: 0, legs: 0, torso: 0 },
      feedback: refVis < 0.3 ? ["Can't see the dancer clearly"] : ["Step into frame!"],
    };
  }

  // Compute per-part similarity using relative joint vectors
  const arms = computePartSimilarity(reference, user, ARM_INDICES);
  const legs = computePartSimilarity(reference, user, LEG_INDICES);
  const torso = computePartSimilarity(reference, user, TORSO_INDICES);

  // Weighted overall
  const similarity = Math.round(arms * 0.4 + legs * 0.35 + torso * 0.25);

  // Generate feedback
  const feedback: string[] = [];
  if (arms < 50) feedback.push("Match their arm positions!");
  else if (arms < 75) feedback.push("Arms are close — tighten it up!");

  if (legs < 50) feedback.push("Watch their footwork!");
  else if (legs < 75) feedback.push("Legs are almost there!");

  if (torso < 50) feedback.push("Match their body angle!");

  if (similarity >= 80) feedback.push("Great match — keep it locked in!");
  else if (similarity >= 60 && feedback.length === 0) feedback.push("Getting close — keep going!");

  if (feedback.length === 0) feedback.push("Try to mirror their moves!");

  return { similarity, parts: { arms, legs, torso }, feedback };
}

/**
 * Compare a group of landmarks between reference and user.
 * Uses relative vectors (each joint relative to the group centroid)
 * normalised by torso height, so body size doesn't matter.
 */
function computePartSimilarity(
  ref: NormalizedLandmark[],
  user: NormalizedLandmark[],
  indices: number[]
): number {
  const refPoints = indices.map((i) => ref[i]);
  const userPoints = indices.map((i) => user[i]);

  // Compute centroids
  const refCentroid = centroid(refPoints);
  const userCentroid = centroid(userPoints);

  // Normalise: torso height (shoulder to hip distance)
  const refScale = torsoScale(ref);
  const userScale = torsoScale(user);

  if (refScale < 0.01 || userScale < 0.01) return 0;

  // Compare relative positions
  let totalDist = 0;
  let count = 0;

  for (let i = 0; i < indices.length; i++) {
    const rp = refPoints[i];
    const up = userPoints[i];
    if ((rp.visibility ?? 0) < 0.3 || (up.visibility ?? 0) < 0.3) continue;

    // Relative to centroid, normalised by torso scale
    const refRelX = (rp.x - refCentroid.x) / refScale;
    const refRelY = (rp.y - refCentroid.y) / refScale;
    // Mirror user X since webcam is flipped
    const userRelX = ((1 - up.x) - (1 - userCentroid.x)) / userScale;
    const userRelY = (up.y - userCentroid.y) / userScale;

    const dx = refRelX - userRelX;
    const dy = refRelY - userRelY;
    totalDist += Math.sqrt(dx * dx + dy * dy);
    count++;
  }

  if (count === 0) return 0;

  const avgDist = totalDist / count;

  // Map distance to 0-100 score (0 dist = 100, dist > 1.5 = 0)
  const score = Math.max(0, Math.min(100, Math.round((1 - avgDist / 1.5) * 100)));
  return score;
}

function centroid(points: NormalizedLandmark[]): { x: number; y: number } {
  let sx = 0, sy = 0, n = 0;
  for (const p of points) {
    if ((p.visibility ?? 0) < 0.3) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0.5, y: 0.5 };
}

function torsoScale(landmarks: NormalizedLandmark[]): number {
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const hipY = (lHip.y + rHip.y) / 2;

  return Math.abs(hipY - shoulderY);
}

function avgVisibility(landmarks: NormalizedLandmark[], indices: number[]): number {
  let sum = 0;
  for (const i of indices) {
    sum += landmarks[i]?.visibility ?? 0;
  }
  return sum / indices.length;
}
