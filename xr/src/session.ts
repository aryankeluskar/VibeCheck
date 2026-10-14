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
const DEFAULT_CALIBRATION: Calibration = { distance: 2.2, hfov: 72, offsetX: 0, offsetY: 0 };

export function loadCalibration(): Calibration {
  try {
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
