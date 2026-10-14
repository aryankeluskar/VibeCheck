/**
 * Mirror Coach engine: camera frames → MediaPipe Pose → comparison against
 * the reference dancer → score, per-limb feedback, and the voice coach.
 *
 * Framework-free on purpose: it reuses the same pose/compare/coach modules
 * as the 2D app in ../app, so improvements land in both.
 *
 * Coordinate convention ("reflection space"): every live pose is expressed as
 * the user sees themselves in a mirror. A headset camera looking at a real
 * mirror already produces that; a webcam looking straight at the user is
 * flipped into it. In reflection space the user follows the reference like a
 * dance-studio mirror, and MediaPipe's left/right labels are swapped relative
 * to the user's real body, so `anatomical()` swaps them back for anything a
 * person reads or hears.
 */

import { loadPose } from '../../app/lib/pose';
import type { NormalizedLandmark, PoseResults } from '../../app/lib/pose';
import {
  classifyPose,
  comparePosesDetailed,
  findClosestFrame,
  normalizePose,
} from '../../app/lib/poseComparison';
import type { DetailedComparison } from '../../app/lib/poseComparison';
import { extractPoses } from '../../app/lib/videoPoseExtractor';
import type { PoseTimeline } from '../../app/lib/videoPoseExtractor';
import { buildPoseSummary, computeScore, resetScoring } from '../../app/shared/scoring';
import { getCoachMessage, resetCoach } from '../../app/shared/coach';
import { setDuckTarget, speak } from '../../app/shared/speech';
import type { AppMode } from '../../app/shared/mode';

export type { NormalizedLandmark, DetailedComparison };

export type LimbKey = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' | 'torso';
export const LIMBS: LimbKey[] = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'torso'];

const SWAP_LIMB: Record<string, string> = {
  leftArm: 'rightArm',
  rightArm: 'leftArm',
  leftLeg: 'rightLeg',
  rightLeg: 'leftLeg',
  torso: 'torso',
};

/** MediaPipe pose landmark left/right pairs. */
const LR_PAIRS: [number, number][] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

/** Flip a direct (selfie-camera) pose into reflection space. */
export function mirrorLandmarks(lm: NormalizedLandmark[]): NormalizedLandmark[] {
  const out = lm.map((p) => ({ ...p, x: 1 - p.x }));
  for (const [a, b] of LR_PAIRS) {
    if (out[a] && out[b]) [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}

/** Re-key a comparison from reflection-space labels to the user's real limbs. */
function anatomical(d: DetailedComparison): DetailedComparison {
  const limbScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.limbScores)) limbScores[SWAP_LIMB[k] ?? k] = v;
  return { ...d, limbScores, worstLimb: SWAP_LIMB[d.worstLimb] ?? d.worstLimb };
}

/**
 * Place the reference pose on the live body: normalize both to the shared
 * hip-centred, torso-scaled frame, then invert the live normalization.
 * Returns landmarks in the live image's [0,1] coordinates.
 */
export function projectReferenceOntoLive(
  ref: NormalizedLandmark[],
  live: NormalizedLandmark[],
  refAspect: number,
  liveAspect: number,
): NormalizedLandmark[] | null {
  const lHip = live[23], rHip = live[24], lSh = live[11], rSh = live[12];
  if (!lHip || !rHip || !lSh || !rSh) return null;
  const hipX = ((lHip.x + rHip.x) / 2) * liveAspect;
  const hipY = (lHip.y + rHip.y) / 2;
  const shX = ((lSh.x + rSh.x) / 2) * liveAspect;
  const shY = (lSh.y + rSh.y) / 2;
  const torso = Math.hypot(shX - hipX, shY - hipY);
  if (torso < 0.01) return null;
  const scale = 0.25 / torso;
  return normalizePose(ref, refAspect).map((p) => ({
    ...p,
    x: ((p.x - 0.5) / scale + hipX) / liveAspect,
    y: (p.y - 0.6) / scale + hipY,
  }));
}

export type EngineState = {
  /** Live pose in reflection space (image coords of what the user sees). */
  live: NormalizedLandmark[] | null;
  /** Reference pose mapped onto the live body, same coords as `live`. */
  ghost: NormalizedLandmark[] | null;
  /** Per-limb scores keyed by the user's real limbs. */
  limbScores: Record<string, number>;
  worstLimb: string | null;
  targetPose: string;
  score: number;
  coachLine: string;
  trackingFps: number;
  status: string;
};

const SCORE_EMA_ALPHA = 0.15;
const MAX_REF_DISTANCE_SEC = 1.0;

export class CoachEngine {
  state: EngineState = {
    live: null,
    ghost: null,
    limbScores: {},
    worstLimb: null,
    targetPose: '',
    score: 0,
    coachLine: '',
    trackingFps: 0,
    status: 'Idle',
  };
  /** Bumped every time `state` changes, so panels redraw only when needed. */
  version = 0;

  timeline: PoseTimeline | null = null;
  mode: AppMode = 'dance';
  /** true: camera sees a mirror reflection (headset). false: camera faces the user. */
  cameraSeesMirror = true;
  voice = true;

  private pose: any = null;
  private inflight = false;
  private lastSend = 0;
  private sendIntervalMs = 66;
  private camera: HTMLVideoElement | null = null;
  private reference: HTMLVideoElement | null = null;
  private resultTimes: number[] = [];
  private smoothed = 0;

  setStatus(status: string) {
    this.state.status = status;
    this.version++;
  }

  /**
   * Fetch the shared pose timeline for a library video, or analyze the clip
   * here (and share it) when no device has done so yet.
   */
  async loadReference(videoId: string, src: string, onProgress: (pct: number) => void) {
    this.timeline = null;
    try {
      const res = await fetch(`/api/poses/${videoId}`);
      if (res.ok) {
        this.timeline = (await res.json()) as PoseTimeline;
        onProgress(100);
        return;
      }
    } catch {
      // fall through to local analysis
    }
    const timeline = await extractPoses(src, onProgress, 0.25);
    this.timeline = timeline;
    fetch(`/api/poses/${videoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(timeline),
    }).catch(() => {});
  }

  /** Start live tracking. Call after loadReference (MediaPipe is a per-page singleton). */
  async start(camera: HTMLVideoElement, reference: HTMLVideoElement, opts: { lite: boolean }) {
    this.camera = camera;
    this.reference = reference;
    // Dip the reference music while the coach voice plays (T4).
    setDuckTarget(reference);
    resetScoring();
    resetCoach();
    this.smoothed = 0;
    if (!this.pose) {
      this.setStatus('Loading pose model…');
      this.pose = await loadPose();
      this.pose.setOptions({ modelComplexity: opts.lite ? 0 : 1 });
      this.pose.onResults((r: PoseResults) => this.onResults(r));
    }
    this.setStatus('Tracking');
  }

  /** Drive from the XR frame loop (window rAF does not run during immersive sessions). */
  tick(nowMs: number) {
    const cam = this.camera;
    if (!this.pose || !cam || this.inflight || cam.readyState < 2) return;
    if (nowMs - this.lastSend < this.sendIntervalMs) return;
    this.lastSend = nowMs;
    this.inflight = true;
    this.pose
      .send({ image: cam })
      .catch(() => {})
      .finally(() => {
        this.inflight = false;
      });
  }

  private onResults(results: PoseResults) {
    const now = performance.now();
    this.resultTimes.push(now);
    while (this.resultTimes.length && now - this.resultTimes[0] > 1000) this.resultTimes.shift();
    this.state.trackingFps = this.resultTimes.length;

    const raw = results.poseLandmarks ?? null;
    const live = raw && raw.length >= 33 ? (this.cameraSeesMirror ? raw : mirrorLandmarks(raw)) : null;
    this.state.live = live;

    const cam = this.camera;
    const ref = this.reference;
    const liveAspect = cam && cam.videoWidth ? cam.videoWidth / cam.videoHeight : 4 / 3;
    const refAspect = ref && ref.videoWidth ? ref.videoWidth / ref.videoHeight : 16 / 9;
    const refTime = ref?.currentTime ?? 0;

    // Heuristic body metrics feed the coach summary (motion energy, lean, …)
    const frame = computeScore(live);

    let detailed: DetailedComparison | null = null;
    this.state.ghost = null;
    if (live && this.timeline) {
      const refFrame = findClosestFrame(this.timeline, refTime);
      if (refFrame && Math.abs(refFrame.time - refTime) <= MAX_REF_DISTANCE_SEC) {
        detailed = comparePosesDetailed(refFrame.landmarks, live, refAspect, liveAspect);
        this.state.ghost = projectReferenceOntoLive(refFrame.landmarks, live, refAspect, liveAspect);
        this.state.targetPose = classifyPose(normalizePose(refFrame.landmarks, refAspect));
      }
    }

    const target = detailed ? Math.round(0.8 * detailed.matchScore + 0.2 * frame.score) : frame.score;
    this.smoothed = this.smoothed * (1 - SCORE_EMA_ALPHA) + target * SCORE_EMA_ALPHA;
    this.state.score = Math.round(this.smoothed);

    const human = detailed ? anatomical(detailed) : null;
    this.state.limbScores = human?.limbScores ?? {};
    this.state.worstLimb = human?.worstLimb ?? null;
    this.version++;

    // Coach only while the reference is playing; getCoachMessage throttles itself
    if (!ref || ref.paused || !live) return;
    const summary = buildPoseSummary(live, { ...frame, score: this.state.score });
    if (human) summary.reference = human;
    getCoachMessage(summary, this.mode).then((result) => {
      if (!result) return;
      this.state.coachLine = result.message;
      this.version++;
      if (this.voice && result.audio) speak(result.audio);
    });
  }
}
