/**
 * Shared state between the 2D setup screen (src/setup.ts) and the immersive
 * MirrorSystem. Kept tiny and explicit so a teammate can follow the flow.
 */

import { CoachEngine } from './engine.js';

export type RefLayout = 'left' | 'top' | 'right';
export const LAYOUTS: RefLayout[] = ['left', 'top', 'right'];

export type Calibration = {
  /** Distance of the head-locked overlay plane, metres. */
  distance: number;
  /** Horizontal field of view the overlay covers, degrees. */
  hfov: number;
  offsetX: number;
  offsetY: number;
};

const CALIBRATION_KEY = 'mirror-coach:calibration:v1';
/**
 * Defaults for a Quest 3 user standing ~1.4 m from a mirror (T2):
 * - distance 2.8 m: the reflection appears at twice the mirror distance, so
 *   the skeleton sits at the reflection's depth and fuses in stereo (the
 *   panels in MirrorSystem assume the same 1.4 m mirror).
 * - hfov 71°: Meta's Spatial SDK samples default the passthrough camera to 72°
 *   horizontal (1280x960, 4:3, undistorted, centred principal point); the
 *   camera sits ~7 cm in front of the eyes, which narrows it slightly.
 * - offsetY -0.03 m: the RGB cameras sit below the eyes and look slightly
 *   down; both push the image down. The tilt is unpublished, so fine-tune
 *   with the left stick.
 * - offsetX 0: the cameras are ~3.5 cm left/right of centre, but which one
 *   "camera 1" is isn't published; a wrong sign would double the error. Check
 *   by covering the left front camera with Y (feed) on, then nudge.
 * None of this is measured on a headset yet. `?recalibrate=1` ignores a
 * saved calibration.
 */
const DEFAULT_CALIBRATION: Calibration = { distance: 2.8, hfov: 71, offsetX: 0, offsetY: -0.03 };

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
