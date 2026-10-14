import type { NormalizedLandmark } from "./pose";
import { POSE_CONNECTIONS } from "./pose";

// Limb groupings — each limb maps to the connections it contains
const LIMB_JOINTS: Record<string, number[]> = {
  rightArm: [12, 14, 16],
  leftArm: [11, 13, 15],
  rightLeg: [24, 26, 28],
  leftLeg: [23, 25, 27],
  torso: [11, 12, 23, 24],
};

// Map each connection to its owning limb
function connectionToLimb(a: number, b: number): string | null {
  for (const [limb, joints] of Object.entries(LIMB_JOINTS)) {
    if (joints.includes(a) && joints.includes(b)) return limb;
  }
  return null;
}

export type PoseComparisonResult = {
  overallScore: number;
  connectionColors: Map<string, string>;
};

export type DetailedComparison = {
  matchScore: number;
  limbScores: Record<string, number>;
  worstLimb: string;
  refPoseLabel: string;
};

const COLOR_GREEN = "#22c55e";
const COLOR_YELLOW = "#eab308";
const COLOR_RED = "#ef4444";

const THRESH_GOOD = 0.06;
const THRESH_OK = 0.12;

/**
 * Normalize a pose so both reference and live skeletons align visually.
 * Centers hip midpoint at (0.5, 0.6) and scales by torso length.
 *
 * @param aspectRatio  width/height of the source video. Used to correct
 *   x-coordinates to a square coordinate space so poses from different
 *   aspect ratios (e.g. 16:9 Zoom vs 4:3 webcam) are comparable.
 *   Defaults to 1 (square / no correction).
 */
export function normalizePose(
  landmarks: NormalizedLandmark[],
  aspectRatio: number = 1
): NormalizedLandmark[] {
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];

  if (!lHip || !rHip || !lShoulder || !rShoulder) {
    return landmarks;
  }

  // First, correct x-coordinates to a square space.
  // MediaPipe returns (x, y) in [0,1] relative to image dims.
  // If aspect ratio is 16:9 (≈1.78), x spans a wider physical range
  // than y. Multiplying x by aspectRatio maps to square physical space.
  const corrected = landmarks.map((lm) => ({
    ...lm,
    x: lm.x * aspectRatio,
  }));

  const cLHip = corrected[23];
  const cRHip = corrected[24];
  const cLShoulder = corrected[11];
  const cRShoulder = corrected[12];

  const hipMidX = (cLHip.x + cRHip.x) / 2;
  const hipMidY = (cLHip.y + cRHip.y) / 2;
  const shoulderMidX = (cLShoulder.x + cRShoulder.x) / 2;
  const shoulderMidY = (cLShoulder.y + cRShoulder.y) / 2;

  const torsoLen = Math.sqrt(
    (shoulderMidX - hipMidX) ** 2 + (shoulderMidY - hipMidY) ** 2
  );

  const TARGET_TORSO = 0.25;
  const scale = torsoLen > 0.01 ? TARGET_TORSO / torsoLen : 1;

  const cx = 0.5;
  const cy = 0.6;

  return corrected.map((lm) => ({
    x: (lm.x - hipMidX) * scale + cx,
    y: (lm.y - hipMidY) * scale + cy,
    z: lm.z,
    visibility: lm.visibility,
  }));
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Classify a pose into a short human-readable label based on landmark geometry.
 */
export function classifyPose(landmarks: NormalizedLandmark[]): string {
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lWrist = landmarks[15];
  const rWrist = landmarks[16];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  const lAnkle = landmarks[27];
  const rAnkle = landmarks[28];

  if (!lShoulder || !rShoulder || !lHip || !rHip) return "Pose";

  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const hipY = (lHip.y + rHip.y) / 2;

  const armsUp =
    lWrist && rWrist && lWrist.y < shoulderY - 0.05 && rWrist.y < shoulderY - 0.05;
  const leftArmUp = lWrist && lWrist.y < shoulderY - 0.05;
  const rightArmUp = rWrist && rWrist.y < shoulderY - 0.05;
  const armsWide =
    lWrist &&
    rWrist &&
    Math.abs(lWrist.x - rWrist.x) > 0.4 &&
    lWrist.y > shoulderY - 0.08 &&
    rWrist.y > shoulderY - 0.08;

  const stanceWidth =
    lAnkle && rAnkle ? Math.abs(lAnkle.x - rAnkle.x) : 0;
  const wideStance = stanceWidth > 0.2;

  const crouching = hipY > 0.6;

  if (armsUp && wideStance) return "Star jump";
  if (armsUp) return "Arms up";
  if (armsWide && wideStance) return "T-pose";
  if (armsWide) return "Arms wide";
  if (leftArmUp && !rightArmUp) return "Left reach";
  if (rightArmUp && !leftArmUp) return "Right reach";
  if (crouching && wideStance) return "Low squat";
  if (crouching) return "Crouch";
  if (wideStance) return "Wide stance";
  return "Neutral";
}

/**
 * Find the closest frame in a timeline to the given timestamp.
 */
export function findClosestFrame(
  timeline: { time: number; landmarks: NormalizedLandmark[] }[],
  time: number
): { time: number; landmarks: NormalizedLandmark[] } | null {
  if (timeline.length === 0) return null;

  let best = timeline[0];
  let bestDist = Math.abs(best.time - time);

  for (let i = 1; i < timeline.length; i++) {
    const d = Math.abs(timeline[i].time - time);
    if (d < bestDist) {
      best = timeline[i];
      bestDist = d;
    }
  }

  return best.landmarks.length > 0 ? best : null;
}

/**
 * Detailed pose comparison returning per-limb scores and worst limb.
 * Reference-centric: only compares landmarks visible in the reference pose.
 * If a landmark exists in the user's pose but not in the reference, it's ignored.
 * If a landmark exists in the reference but not in the user's pose, it counts as a penalty.
 *
 * @param refAspectRatio  width/height of the reference video (e.g. Zoom 16:9 → 1.78)
 * @param liveAspectRatio width/height of the live webcam (e.g. 4:3 → 1.33)
 */
export function comparePosesDetailed(
  refLandmarks: NormalizedLandmark[],
  liveLandmarks: NormalizedLandmark[],
  refAspectRatio: number = 1,
  liveAspectRatio: number = 1
): DetailedComparison | null {
  const refNorm = normalizePose(refLandmarks, refAspectRatio);
  const liveNorm = normalizePose(liveLandmarks, liveAspectRatio);

  const limbScores: Record<string, number> = {};

  for (const [limb, joints] of Object.entries(LIMB_JOINTS)) {
    const distances: number[] = [];
    let missingCount = 0;

    for (const idx of joints) {
      const r = refNorm[idx];
      const l = liveNorm[idx];

      // Skip if reference landmark doesn't exist or has low visibility
      // (user's extra landmarks are ignored)
      if (!r || (r.visibility ?? 0) < 0.3) continue;

      // Reference landmark exists and is visible
      // Check if user's landmark exists
      if (!l || (l.visibility ?? 0) < 0.3) {
        // User is missing a landmark that the reference has - penalize heavily
        missingCount++;
        distances.push(THRESH_OK * 2); // Maximum penalty distance
      } else {
        // Both landmarks exist - measure distance
        distances.push(dist(r, l));
      }
    }

    if (distances.length === 0) {
      limbScores[limb] = 50; // unknown — neutral score
    } else {
      const avg = distances.reduce((s, d) => s + d, 0) / distances.length;
      limbScores[limb] = Math.max(0, Math.min(100, Math.round(100 * (1 - avg / (THRESH_OK * 2)))));
    }
  }

  const entries = Object.entries(limbScores);
  if (entries.length === 0) return null;

  const matchScore = Math.round(entries.reduce((s, [, v]) => s + v, 0) / entries.length);
  const worstLimb = entries.reduce((worst, curr) => curr[1] < worst[1] ? curr : worst)[0];
  const refPoseLabel = classifyPose(refNorm);

  return { matchScore, limbScores, worstLimb, refPoseLabel };
}

/**
 * Compare two normalized poses. Returns an overall score (0-100)
 * and a per-connection color map for drawSkeleton.
 * Reference-centric: only compares landmarks visible in the reference pose.
 */
export function comparePoses(
  ref: NormalizedLandmark[],
  live: NormalizedLandmark[]
): PoseComparisonResult {
  const limbDistances: Record<string, number[]> = {};
  for (const limb of Object.keys(LIMB_JOINTS)) {
    limbDistances[limb] = [];
  }

  // Compute per-joint distances grouped by limb (reference-centric)
  for (const limb of Object.keys(LIMB_JOINTS)) {
    for (const idx of LIMB_JOINTS[limb]) {
      const r = ref[idx];
      const l = live[idx];

      // Skip if reference landmark doesn't exist or has low visibility
      if (!r || (r.visibility ?? 0) < 0.3) continue;

      // Reference landmark exists - check user's landmark
      if (!l || (l.visibility ?? 0) < 0.3) {
        // User is missing a landmark that reference has - maximum penalty
        limbDistances[limb].push(THRESH_OK * 2);
      } else {
        // Both exist - measure distance
        limbDistances[limb].push(dist(r, l));
      }
    }
  }

  // Average distance per limb → color
  const limbColors: Record<string, string> = {};
  const limbScores: number[] = [];

  for (const [limb, distances] of Object.entries(limbDistances)) {
    if (distances.length === 0) {
      limbColors[limb] = COLOR_YELLOW;
      continue;
    }
    const avg = distances.reduce((s, d) => s + d, 0) / distances.length;
    limbColors[limb] =
      avg < THRESH_GOOD ? COLOR_GREEN : avg < THRESH_OK ? COLOR_YELLOW : COLOR_RED;
    // Score: 100 at distance 0, 0 at distance THRESH_OK*2
    limbScores.push(Math.max(0, Math.min(100, 100 * (1 - avg / (THRESH_OK * 2)))));
  }

  // Map connections to their limb color
  const connectionColors = new Map<string, string>();
  for (const [a, b] of POSE_CONNECTIONS) {
    const limb = connectionToLimb(a, b);
    if (limb && limbColors[limb]) {
      connectionColors.set(`${a}-${b}`, limbColors[limb]);
    }
  }

  const overallScore =
    limbScores.length > 0
      ? Math.round(limbScores.reduce((s, v) => s + v, 0) / limbScores.length)
      : 0;

  return { overallScore, connectionColors };
}
