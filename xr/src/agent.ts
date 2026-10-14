/**
 * Agent API: `window.mirrorCoach.agent`, one documented surface for coding
 * agents (and teammates) to inspect and drive /xr instead of tapping DOM
 * buttons or reading internals.
 *
 *   agent.help()              every action and what it does
 *   agent.status()            one JSON snapshot: setup, camera, XR, tracking, scores, coach, report
 *   agent.log(n = 40)         the last n events (setup steps, XR state, runs, errors)
 *   agent.do(name, args?)     run an action; resolves with its result
 *
 * Reach it from a headset over ADB (`node scripts/quest-drive.mjs do <action> [json]`),
 * from Playwright (`page.evaluate(() => mirrorCoach.agent.status())`, see
 * scripts/xr-verify.mjs), or the browser console. Actions are registered by
 * the module that owns the behavior (setup.ts, mirror-system.ts).
 */

import { beaconInfo } from './beacon.js';
import { logEvent, recentEvents } from './events.js';
import { session } from './session.js';

type Action = { help: string; run: (args?: any) => unknown };
const actions = new Map<string, Action>();

export function registerAction(name: string, help: string, run: Action['run']) {
  actions.set(name, { help, run });
}

export function status() {
  const s = session.engine.state;
  const cam = session.camera;
  const ref = session.reference;
  return {
    setup: beaconInfo.setupStatus,
    started: session.started,
    xr: beaconInfo.xrVisibility,
    page: document.visibilityState,
    clip: { id: beaconInfo.clip, title: session.title, mode: session.engine.mode },
    cameras: beaconInfo.cameras,
    camera: cam ? { w: cam.videoWidth, h: cam.videoHeight, ready: cam.readyState } : null,
    sees: session.engine.cameraSeesMirror ? 'mirror' : 'direct',
    layout: session.layout,
    calibration: session.calibration,
    ref: ref ? { t: +ref.currentTime.toFixed(1), dur: +(ref.duration || 0).toFixed(1), paused: ref.paused } : null,
    timelineFrames: session.engine.timeline?.length ?? 0,
    engine: {
      status: s.status,
      fps: s.trackingFps,
      live: !!s.live,
      score: s.score,
      limbs: s.limbScores,
      worst: s.worstLimb,
      target: s.targetPose,
      coach: s.coachLine,
    },
    report: beaconInfo.report,
  };
}

export const agent = {
  help: () => Object.fromEntries([...actions].map(([name, a]) => [name, a.help])),
  status,
  log: (n = 40) => recentEvents(n),
  async do(name: string, args?: unknown) {
    const action = actions.get(name);
    if (!action) throw new Error(`Unknown action "${name}". Actions: ${[...actions.keys()].join(', ')}`);
    logEvent(`agent ${name}${args === undefined ? '' : ` ${JSON.stringify(args)}`}`);
    return await action.run(args);
  },
};

export function installAgent() {
  window.addEventListener('error', (e) => logEvent(`error ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => logEvent(`rejection ${String(e.reason)}`));
  document.addEventListener('visibilitychange', () => logEvent(`page ${document.visibilityState}`));
  Object.assign(session, { agent });
  logEvent('page loaded');
}
