/**
 * MediaPipe Pose setup and skeleton drawing utilities.
 * SHARED MODULE — used by both the YouTube app and the Zoom app.
 *
 * We load MediaPipe Pose from CDN to avoid bundling WASM in Next.js.
 */

export type NormalizedLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type PoseResults = {
  poseLandmarks?: NormalizedLandmark[];
};

// Virtual landmark index for the synthetic neck (midpoint of shoulders 11 & 12)
export const NECK_INDEX = 33;

// MediaPipe Pose connections (pairs of landmark indices)
// 0 = nose, 33 = synthetic neck midpoint between shoulders
export const POSE_CONNECTIONS: [number, number][] = [
  [0, NECK_INDEX],
  [NECK_INDEX, 11],
  [NECK_INDEX, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
];

/**
 * Draw a skeleton overlay on a canvas from pose landmarks.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  // Synthesize a neck landmark as midpoint of shoulders (11 & 12)
  const lmWithNeck = [...landmarks];
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  if (lShoulder && rShoulder) {
    const minVis = Math.min(lShoulder.visibility ?? 0, rShoulder.visibility ?? 0);
    lmWithNeck[NECK_INDEX] = {
      x: (lShoulder.x + rShoulder.x) / 2,
      y: (lShoulder.y + rShoulder.y) / 2,
      z: (lShoulder.z + rShoulder.z) / 2,
      visibility: minVis,
    };
  }

  // Draw connections
  ctx.strokeStyle = "#00FF88";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  for (const [a, b] of POSE_CONNECTIONS) {
    const la = lmWithNeck[a];
    const lb = lmWithNeck[b];
    if (!la || !lb) continue;
    if ((la.visibility ?? 0) < 0.3 || (lb.visibility ?? 0) < 0.3) continue;

    ctx.beginPath();
    // Mirror x for webcam
    ctx.moveTo((1 - la.x) * width, la.y * height);
    ctx.lineTo((1 - lb.x) * width, lb.y * height);
    ctx.stroke();
  }

  // Draw keypoints: nose (0), neck (33), body (11+)
  ctx.fillStyle = "#FF4488";
  const keypointIndices = [0, NECK_INDEX, ...Array.from({ length: landmarks.length - 11 }, (_, i) => i + 11)];
  for (const i of keypointIndices) {
    const lm = lmWithNeck[i];
    if (!lm || (lm.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.arc((1 - lm.x) * width, lm.y * height, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * Dynamically loads MediaPipe Pose scripts from CDN.
 * Returns a configured Pose instance.
 * Retries up to 3 times on transient CDN failures.
 */
export async function loadPose(): Promise<unknown> {
  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous";
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js"
      );

      await delay(100);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mp = (window as any).Pose;
      if (!mp) throw new Error("MediaPipe Pose global not available");

      const pose = new mp({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      return pose;
    } catch (err) {
      console.warn(`[Pose] Attempt ${attempt}/${MAX_RETRIES} failed:`, err);
      if (attempt === MAX_RETRIES) throw err;
      const tag = document.querySelector(
        `script[src*="@mediapipe/pose@0.5.1675469404/pose.js"]`
      );
      tag?.remove();
      await delay(1000 * attempt);
    }
  }

  throw new Error("MediaPipe Pose failed to load after retries");
}
