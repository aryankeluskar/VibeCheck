/**
 * Debug beacon: posts a snapshot of the app state to /api/debug every 5 s so
 * we can see what the headset sees without adb. Read it with
 * `curl https://<host>/api/debug`. Opt-in with /xr?beacon=1: every post is a
 * Vercel Blob write, so leaving it on in every tab (judges included) could
 * use up the Blob allowance the video library depends on.
 */

import { session } from './session.js';

const errors: string[] = [];
const pushError = (msg: string) => {
  errors.push(`${new Date().toISOString().slice(11, 19)} ${msg}`.slice(0, 300));
  if (errors.length > 15) errors.shift();
};

export const beaconInfo = {
  cameras: [] as { label: string; facing: string }[],
  setupStatus: '',
  xrVisibility: 'non-immersive',
  report: 'none',
};

export function startBeacon() {
  if (new URLSearchParams(location.search).get('beacon') !== '1') return;

  window.addEventListener('error', (e) => pushError(`error: ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => pushError(`rejection: ${String(e.reason)}`));
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    pushError(`console: ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`);
    origError(...args);
  };

  let device = '';
  try {
    device = sessionStorage.getItem('mirror-coach:device') ?? '';
    if (!device) {
      device = `${/OculusBrowser/.test(navigator.userAgent) ? 'quest' : 'desk'}-${Math.random().toString(36).slice(2, 7)}`;
      sessionStorage.setItem('mirror-coach:device', device);
    }
  } catch {
    device = `dev-${Math.random().toString(36).slice(2, 7)}`;
  }

  const send = () => {
    const s = session.engine.state;
    const cam = session.camera;
    const ref = session.reference;
    const snap = {
      device,
      ts: new Date().toISOString(),
      ua: navigator.userAgent,
      visible: document.visibilityState,
      xr: beaconInfo.xrVisibility,
      setup: beaconInfo.setupStatus,
      started: session.started,
      cameras: beaconInfo.cameras,
      camera: cam ? { w: cam.videoWidth, h: cam.videoHeight, ready: cam.readyState } : null,
      sees: session.engine.cameraSeesMirror ? 'mirror' : 'direct',
      layout: session.layout,
      calibration: session.calibration,
      ref: ref
        ? { t: +ref.currentTime.toFixed(1), dur: +(ref.duration || 0).toFixed(1), paused: ref.paused, w: ref.videoWidth }
        : null,
      timelineFrames: session.engine.timeline?.length ?? 0,
      report: beaconInfo.report,
      engine: {
        status: s.status,
        fps: s.trackingFps,
        live: !!s.live,
        ghost: !!s.ghost,
        score: s.score,
        limbs: s.limbScores,
        worst: s.worstLimb,
        target: s.targetPose,
        coach: s.coachLine,
      },
      errors,
    };
    fetch('/api/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snap),
      keepalive: true,
    }).catch(() => {});
  };
  setInterval(() => {
    if (document.visibilityState !== 'hidden') send();
  }, 5000);
  send();
}
