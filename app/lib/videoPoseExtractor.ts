import { loadPose } from "./pose";
import type { NormalizedLandmark, PoseResults } from "./pose";

export type PoseFrame = {
  time: number;
  landmarks: NormalizedLandmark[];
};

export type PoseTimeline = PoseFrame[];

export type StripPoseFrame = {
  time: number;
  landmarks: NormalizedLandmark[];
  thumbnail?: string;
};

export type StripPoseTimeline = StripPoseFrame[];

const MAX_EXTRACT_DIM = 320;

/** Create a hidden video + aspect-ratio-matched canvas for extraction. */
async function prepareExtractionElements(videoSrc: string) {
  const video = document.createElement("video");
  video.src = videoSrc;
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.style.display = "none";
  document.body.appendChild(video);

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video for pose extraction"));
    video.load();
  });

  const duration = video.duration;
  if (!duration || !isFinite(duration)) {
    video.remove();
    throw new Error("Video has no valid duration");
  }

  // Scale canvas to match video aspect ratio (max 320px on longest side)
  const vw = video.videoWidth || 320;
  const vh = video.videoHeight || 240;
  const scale = Math.min(MAX_EXTRACT_DIM / vw, MAX_EXTRACT_DIM / vh);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  canvas.style.display = "none";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pose = (await loadPose()) as any;

  const cleanup = () => {
    video.remove();
    canvas.remove();
  };

  return { video, canvas, ctx, pose, duration, cleanup };
}

/**
 * Extracts pose landmarks from a video at ~10fps by seeking through frames.
 * Runs client-side using the same MediaPipe Pose model as the webcam.
 */
export async function extractPoses(
  videoSrc: string,
  onProgress: (percent: number) => void
): Promise<PoseTimeline> {
  const { video, canvas, ctx, pose, duration, cleanup } =
    await prepareExtractionElements(videoSrc);

  const timeline: PoseTimeline = [];
  const step = 0.1; // 10fps

  // Wrap onResults in a promise-based interface for sequential processing
  let resolveFrame: ((landmarks: NormalizedLandmark[]) => void) | null = null;

  pose.onResults((results: PoseResults) => {
    if (resolveFrame) {
      resolveFrame(results.poseLandmarks ? [...results.poseLandmarks] : []);
      resolveFrame = null;
    }
  });

  for (let t = 0; t < duration; t += step) {
    // Seek to time
    video.currentTime = t;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    // Draw frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Run pose detection and wait for result
    const landmarks = await new Promise<NormalizedLandmark[]>((resolve) => {
      resolveFrame = resolve;
      pose.send({ image: canvas });
    });

    timeline.push({ time: t, landmarks });
    onProgress((t / duration) * 100);
  }

  onProgress(100);
  cleanup();
  return timeline;
}

/**
 * Calculate an "interest score" for a pose frame based on movement energy,
 * pose extremity, and distinctiveness from neighbors.
 */
function calculateInterestScore(
  frame: StripPoseFrame,
  prevFrame: StripPoseFrame | null,
  nextFrame: StripPoseFrame | null
): number {
  if (!frame.landmarks || frame.landmarks.length === 0) return 0;

  let score = 0;
  const landmarks = frame.landmarks;

  // 1. Motion energy: displacement from previous frame
  if (prevFrame && prevFrame.landmarks.length > 0) {
    let totalDisp = 0;
    const count = Math.min(landmarks.length, prevFrame.landmarks.length);
    for (let i = 0; i < count; i++) {
      const dx = landmarks[i].x - prevFrame.landmarks[i].x;
      const dy = landmarks[i].y - prevFrame.landmarks[i].y;
      totalDisp += Math.sqrt(dx * dx + dy * dy);
    }
    const avgDisp = totalDisp / count;
    score += avgDisp * 100; // Weight motion heavily
  }

  // 2. Pose extremity: how far from neutral positions
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];

  if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
    // High or very low arms are interesting
    const avgWristY = (leftWrist.y + rightWrist.y) / 2;
    const avgShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
    const armHeight = Math.abs(avgWristY - avgShoulderY);
    score += armHeight * 20;

    // Wide arm spread is interesting
    const armSpread = Math.abs(leftWrist.x - rightWrist.x);
    score += armSpread * 15;
  }

  if (leftHip && rightHip && leftKnee && rightKnee) {
    // Deep knee bends are interesting
    const avgKneeY = (leftKnee.y + rightKnee.y) / 2;
    const avgHipY = (leftHip.y + rightHip.y) / 2;
    const kneeBend = Math.abs(avgKneeY - avgHipY);
    score += kneeBend * 25;
  }

  // 3. Local peak: higher interest than neighbors
  if (prevFrame && nextFrame) {
    const prevScore = prevFrame.landmarks.length > 0 ? 1 : 0;
    const nextScore = nextFrame.landmarks.length > 0 ? 1 : 0;
    if (prevScore > 0 && nextScore > 0) {
      score += 5; // Bonus for being between valid frames (local maxima candidate)
    }
  }

  return score;
}

/**
 * Select the most interesting frames from a dense timeline.
 * Uses greedy selection with temporal spacing constraints.
 */
function selectInterestingFrames(
  denseTL: StripPoseTimeline,
  targetCount: number
): StripPoseTimeline {
  if (denseTL.length <= targetCount) return denseTL;

  // Score all frames
  type ScoredFrame = StripPoseFrame & { score: number; index: number };
  const scored: ScoredFrame[] = denseTL.map((frame, i) => {
    const prev = i > 0 ? denseTL[i - 1] : null;
    const next = i < denseTL.length - 1 ? denseTL[i + 1] : null;
    return {
      ...frame,
      score: calculateInterestScore(frame, prev, next),
      index: i,
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Greedy selection with minimum time spacing
  const selected: ScoredFrame[] = [];
  const minSpacing = (denseTL[denseTL.length - 1].time - denseTL[0].time) / (targetCount * 1.5);

  for (const candidate of scored) {
    if (selected.length >= targetCount) break;

    // Check if too close to any already-selected frame
    const tooClose = selected.some(
      (s) => Math.abs(s.time - candidate.time) < minSpacing
    );

    if (!tooClose) {
      selected.push(candidate);
    }
  }

  // Sort selected frames by time
  selected.sort((a, b) => a.time - b.time);

  // Remove temporary scoring fields
  return selected.map(({ score: _score, index: _index, ...frame }) => frame);
}

/**
 * Extracts interesting poses for the MoveQueue strip using smart frame selection.
 * Samples densely, then selects the most dynamic/interesting frames.
 */
export async function extractStripPoses(
  videoSrc: string,
  onProgress: (percent: number) => void,
  targetFrameCount = 20 // Approximate number of frames to display
): Promise<StripPoseTimeline> {
  const { video, canvas, ctx, pose, duration, cleanup } =
    await prepareExtractionElements(videoSrc);

  // Sample at 0.5s intervals for better coverage
  const samplingInterval = 0.5;
  const denseTL: StripPoseTimeline = [];

  let resolveFrame: ((landmarks: NormalizedLandmark[]) => void) | null = null;
  pose.onResults((results: PoseResults) => {
    if (!resolveFrame) return;
    resolveFrame(results.poseLandmarks ? [...results.poseLandmarks] : []);
    resolveFrame = null;
  });

  // Extract dense timeline
  for (let t = 0; t < duration; t += samplingInterval) {
    video.currentTime = t;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/jpeg", 0.6);

    const landmarks = await new Promise<NormalizedLandmark[]>((resolve) => {
      resolveFrame = resolve;
      pose.send({ image: canvas });
    });

    denseTL.push({ time: t, landmarks, thumbnail });
    onProgress((t / duration) * 80); // Reserve 20% for selection
  }

  // Select most interesting frames
  const selectedTL = selectInterestingFrames(denseTL, targetFrameCount);

  // Fill missing landmarks
  const finalTL = fillMissingStripLandmarks(selectedTL);

  onProgress(100);
  cleanup();
  return finalTL;
}

function fillMissingStripLandmarks(timeline: StripPoseTimeline): StripPoseTimeline {
  if (timeline.length === 0) return timeline;

  const nextValidIdx: number[] = Array(timeline.length).fill(-1);
  let next = -1;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    if (timeline[i].landmarks.length > 0) next = i;
    nextValidIdx[i] = next;
  }

  let prev = -1;
  return timeline.map((frame, i) => {
    if (frame.landmarks.length > 0) {
      prev = i;
      return frame;
    }

    const nextIdx = nextValidIdx[i];
    if (prev === -1 && nextIdx === -1) return frame;

    if (prev === -1) {
      return { ...frame, landmarks: [...timeline[nextIdx].landmarks], thumbnail: frame.thumbnail ?? timeline[nextIdx].thumbnail };
    }
    if (nextIdx === -1) {
      return { ...frame, landmarks: [...timeline[prev].landmarks], thumbnail: frame.thumbnail ?? timeline[prev].thumbnail };
    }

    const prevDelta = Math.abs(frame.time - timeline[prev].time);
    const nextDelta = Math.abs(timeline[nextIdx].time - frame.time);
    const source = prevDelta <= nextDelta ? timeline[prev] : timeline[nextIdx];
    return { ...frame, landmarks: [...source.landmarks], thumbnail: frame.thumbnail ?? source.thumbnail };
  });
}
