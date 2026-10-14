/**
 * Pose Manager — creates independent MediaPipe Pose instances for
 * each video source. Each instance runs its own rAF processing loop.
 *
 * MediaPipe Pose CAN support multiple instances as long as they
 * don't call .send() concurrently. We serialize sends with a mutex.
 */

import type { NormalizedLandmark, PoseResults } from "./pose";

type PoseCallback = (landmarks: NormalizedLandmark[] | null) => void;

// Global mutex to ensure only one pose.send() at a time
let sendLock: Promise<void> = Promise.resolve();

function acquireLock(): Promise<() => void> {
  let release: () => void;
  const prev = sendLock;
  sendLock = new Promise((resolve) => {
    release = resolve;
  });
  return prev.then(() => release!);
}

/**
 * Load a fresh Pose instance from the CDN.
 */
async function createPoseInstance(): Promise<unknown> {
  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
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

  await loadScript(
    "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js"
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PoseClass = (window as any).Pose;
  if (!PoseClass) throw new Error("MediaPipe Pose not loaded");

  const pose = new PoseClass({
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
}

/**
 * Register a video source for pose detection.
 * Creates a dedicated Pose instance and rAF loop for this source.
 * Returns an unregister/cleanup function.
 */
export async function registerPoseSource(
  id: string,
  getVideo: () => HTMLVideoElement | null,
  callback: PoseCallback
): Promise<() => void> {
  console.log(`[PoseManager] Creating pose instance for "${id}"...`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pose = (await createPoseInstance()) as any;

  let active = true;
  let raf = 0;

  // Set up results handler
  pose.onResults((results: PoseResults) => {
    const landmarks = results.poseLandmarks ?? null;
    if (active) callback(landmarks);
  });

  // Initialize with a small test frame to warm up WASM
  const warmupCanvas = document.createElement("canvas");
  warmupCanvas.width = 64;
  warmupCanvas.height = 64;
  try {
    const release = await acquireLock();
    await pose.send({ image: warmupCanvas });
    release();
  } catch {
    // warmup may fail, that's ok
  }

  console.log(`[PoseManager] Pose instance for "${id}" ready`);

  const processFrame = async () => {
    if (!active) return;

    const video = getVideo();
    if (video && video.readyState >= 2) {
      const release = await acquireLock();
      if (!active) { release(); return; }
      try {
        await pose.send({ image: video });
      } catch {
        // ignore transient errors
      }
      release();
    }

    if (active) {
      raf = requestAnimationFrame(processFrame);
    }
  };

  raf = requestAnimationFrame(processFrame);

  return () => {
    console.log(`[PoseManager] Cleaning up "${id}"`);
    active = false;
    cancelAnimationFrame(raf);
  };
}
