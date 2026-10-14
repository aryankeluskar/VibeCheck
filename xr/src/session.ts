/**
 * Shared state between the 2D setup screen (src/setup.ts) and the immersive
 * MirrorSystem. Kept tiny and explicit so a teammate can follow the flow.
 */

import { CoachEngine } from './engine.js';

export type RefLayout = 'left' | 'top' | 'right';
export const LAYOUTS: RefLayout[] = ['left', 'top', 'right'];

export type Calibration = {
  /** Reflection distance, metres: where the overlay plane sits. Measured live unless autoDistance is off. */
  distance: number;
  /** Measure `distance` from the tracked body's size every frame (camera sees a mirror). */
  autoDistance: boolean;
  /** Horizontal field of view the overlay covers, degrees; vertical follows the image aspect. */
  hfov: number;
  /** How far the headset camera looks down from where the head faces, degrees. */
  pitch: number;
  /** Camera position from the centre of the eyes, metres (x right, y up, z back). */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  /** Camera capture to browser delay, ms: how far back to look up the head pose of a frame. */
  latencyMs: number;
};

const CALIBRATION_KEY = 'mirror-coach:calibration:v3';
/**
 * Quest 3 passthrough camera, measured from the headset's own Camera2
 * calibration (`adb shell dumpsys media.camera`, 2:50pm):
 * - fx = fy = 869 px on a 1280x1280 sensor, principal point centred. The
 *   browser stream is a centre crop of it (cropRegion 0,160,1280,960), so it
 *   covers 72.7° x 57.8° (2·atan(640/869) x 2·atan(480/869)).
 * - lens pose rotation 168.9° about x against the 180° camera flip: the
 *   camera looks 11° below where the head faces.
 * - the browser opens the left camera, (-3.2, -1.7, -6.2) cm from the centre
 *   of the eyes.
 * - distance: measured live from the body (MirrorSystem.measureDistance);
 *   3.4 m, a user 1.7 m from the mirror, until the first measurement.
 * Fine-tune live with `mirrorCoach.agent.do('calibrate', {...})` or the
 * sticks. `?recalibrate=1` ignores a saved calibration.
 */
const DEFAULT_CALIBRATION: Calibration = {
  distance: 3.4,
  autoDistance: true,
  hfov: 72.7,
  pitch: 11,
  offsetX: -0.032,
  offsetY: -0.017,
  offsetZ: -0.062,
  latencyMs: 60,
};

export function loadCalibration(): Calibration {
  try {
    if (new URLSearchParams(location.search).get('recalibrate') === '1') {
      localStorage.removeItem(CALIBRATION_KEY);
    }
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (raw) return { ...DEFAULT_CALIBRATION, ...JSON.parse(raw) };
  } catch {
    // storage blocked
  }
  return { ...DEFAULT_CALIBRATION };
}

export function saveCalibration(c: Calibration) {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(c));
  } catch {
    // storage blocked
  }
}

export const session = {
  engine: new CoachEngine(),
  reference: null as HTMLVideoElement | null,
  camera: null as HTMLVideoElement | null,
  title: '',
  layout: 'left' as RefLayout,
  calibration: loadCalibration(),
  /** Set by setup when the user starts; MirrorSystem builds panels then. */
  started: false,
};
