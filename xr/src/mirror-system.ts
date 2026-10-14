/**
 * MirrorSystem: builds the mixed-reality layout and runs the coach every
 * XR frame.
 *
 *   ┌──────────┐   ┌────────── real mirror ──────────┐
 *   │ reference│   │  your reflection + head-locked   │
 *   │  video   │   │  skeleton, limb labels, ghost    │
 *   ├──────────┤   │  of the reference pose           │
 *   │   HUD    │   └──────────────────────────────────┘
 *   └──────────┘
 *
 * Controller map (also printed on the HUD):
 *   A  play / pause        B  restart
 *   X  move reference panel (left → top → right)
 *   Y  show/hide camera feed (alignment aid)
 *   Right stick  ↕ overlay size, ↔ overlay x · Left stick ↕ overlay y
 *   Trigger on a panel: grab and move it
 * When the clip finishes a full play-through the video pauses and a report
 * card appears in front of you; A (or B) starts the next run.
 * Desktop keys: Space, R, L, C, arrows/[ ] for calibration, G to end the run now.
 */

import {
  createSystem,
  DistanceGrabbable,
  InputComponent,
  MovementMode,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { HudPanel, OverlayPanel, ReferencePanel } from './panels.js';
import { fetchReport, ReportPanel, summarize } from './report.js';
import { registerAction } from './agent.js';
import { beaconInfo } from './beacon.js';
import { logEvent } from './events.js';
import { LAYOUTS, saveCalibration, session, type RefLayout } from './session.js';

const HINT = 'A play · B restart · X layout · Y camera · sticks calibrate';
const DEADZONE = 0.25;

export class MirrorSystem extends createSystem({}) {
  private overlay!: OverlayPanel;
  private hud!: HudPanel;
  private refPanel: ReferencePanel | null = null;
  private refEntity: Entity | null = null;
  private hudEntity: Entity | null = null;
  private report!: ReportPanel;
  private reportEntity: Entity | null = null;
  private reportToken = 0;
  private lastRefT = 0;
  private built = false;
  /** What the panels currently show; the setup screen can swap these between sessions. */
  private boundRef: HTMLVideoElement | null = null;
  private boundCam: HTMLVideoElement | null = null;
  private boundSeesMirror = true;
  private lastVersion = -1;
  private lastHudDraw = 0;
  private relayoutIn = -1;
  private headPos!: Vector3;
  private headDir!: Vector3;
  private right!: Vector3;
  private anchor!: Vector3;
  private tmp!: Vector3;

  init(): void {
    this.headPos = new Vector3();
    this.headDir = new Vector3();
    this.right = new Vector3();
    this.anchor = new Vector3();
    this.tmp = new Vector3();
    this.overlay = new OverlayPanel();
    this.hud = new HudPanel();
    this.report = new ReportPanel();

    // Agent actions for the immersive session (see agent.ts).
    registerAction('play', 'Play the reference', () => session.reference?.play());
    registerAction('pause', 'Pause the reference', () => session.reference?.pause());
    registerAction('restart', 'Restart the run from 0:00', () => this.restart());
    registerAction('finishRun', 'End the run now and show the report card', () => this.finishRun(true));
    registerAction('goAgain', 'Hide the report card and start the next run', () => this.goAgain());
    registerAction('layout', 'Reference position: {layout: "left" | "top" | "right"}', (a: { layout: RefLayout }) => {
      if (!LAYOUTS.includes(a?.layout)) throw new Error(`layout must be one of ${LAYOUTS.join(', ')}`);
      session.layout = a.layout;
      this.layoutPanels();
      return session.layout;
    });
    registerAction('recenter', 'Re-anchor the panels in front of the current head pose', () => this.layoutPanels());
    registerAction('feed', 'Show or hide the camera feed under the skeleton: {on: boolean}', (a: { on: boolean }) => {
      this.overlay.feedVisible = !!a?.on;
      return this.overlay.feedVisible;
    });
    registerAction(
      'calibrate',
      'Overlay calibration, saved on this device: any of {distance (m), hfov (deg), offsetX (m), offsetY (m)}',
      (a: Partial<Record<'distance' | 'hfov' | 'offsetX' | 'offsetY', number>>) => {
        const c = session.calibration;
        for (const k of ['distance', 'hfov', 'offsetX', 'offsetY'] as const) {
          if (typeof a?.[k] === 'number' && Number.isFinite(a[k])) c[k] = a[k]!;
        }
        this.applyCalibration();
        saveCalibration(c);
        return { ...c };
      },
    );
    registerAction('exitXR', 'End the immersive session (back to the setup screen)', () => this.world.session?.end());

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        beaconInfo.xrVisibility = String(state);
        logEvent(`xr ${state}`);
        // Re-anchor panels in front of the user a few frames into the session,
        // once the headset pose is real.
        if (state !== VisibilityState.NonImmersive) this.relayoutIn = 15;
      }),
    );
  }

  /** Point the overlay feed at the current camera and its facing. */
  private bindCamera() {
    this.boundCam = session.camera;
    this.boundSeesMirror = session.engine.cameraSeesMirror;
    this.overlay.setFeed(session.camera, !session.engine.cameraSeesMirror);
    this.applyCalibration();
    // A camera facing the user (laptop webcam, emulator) has no passthrough
    // behind it, so show the feed; a headset camera looking at a mirror doesn't
    // need it (the real reflection is visible). Y toggles either way.
    this.overlay.feedVisible = !session.engine.cameraSeesMirror;
  }

  private build() {
    const ref = session.reference!;
    // Head-locked overlay: parented to the head so camera-image coordinates
    // stay registered with the passthrough view (exact view alignment).
    this.world.createTransformEntity(this.overlay.root, this.world.playerHeadEntity);
    this.bindCamera();

    this.boundRef = ref;
    this.refPanel = new ReferencePanel(ref);
    this.refEntity = this.world.createTransformEntity(this.refPanel.root);
    this.hudEntity = this.world.createTransformEntity(this.hud.mesh);
    this.reportEntity = this.world.createTransformEntity(this.report.mesh);
    this.report.mesh.visible = false;
    // Console handle for testing the card without dancing a whole clip.
    Object.assign(session, { finishRun: () => this.finishRun(true), reportStatus: () => this.report.status, reportCanvas: this.report.panel.canvas });
    for (const e of [this.refEntity, this.hudEntity, this.reportEntity]) {
      e.addComponent(RayInteractable);
      e.addComponent(DistanceGrabbable, { movementMode: MovementMode.MoveFromTarget });
    }
    this.layoutPanels();
    this.built = true;
  }

  private applyCalibration() {
    const c = session.calibration;
    const cam = session.camera;
    const aspect = cam && cam.videoWidth ? cam.videoWidth / cam.videoHeight : 4 / 3;
    this.overlay.layout(c.distance, c.hfov, aspect, c.offsetX, c.offsetY);
  }

  /** Place the reference video + HUD around the mirror, relative to the head. */
  private layoutPanels() {
    if (!this.refEntity || !this.hudEntity) return;
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldDirection(this.headDir);
    // Object3D.getWorldDirection returns +Z for cameras; forward is -Z.
    this.headDir.multiplyScalar(-1);
    this.headDir.y = 0;
    if (this.headDir.lengthSq() < 1e-4) this.headDir.set(0, 0, -1);
    this.headDir.normalize();
    this.right.set(-this.headDir.z, 0, this.headDir.x);

    const eyeY = this.headPos.y;
    const side = session.layout === 'right' ? 1 : -1;
    const ref = this.refEntity.object3D!;
    const hud = this.hudEntity.object3D!;

    // Panels ~1.4 m ahead: a little in front of a mirror ~1.7 m away, and readable.
    this.anchor.copy(this.headPos).addScaledVector(this.headDir, 1.4);
    if (session.layout === 'top') {
      ref.position.copy(this.anchor).setY(eyeY + 0.6);
      hud.position.copy(this.anchor).addScaledVector(this.right, -1.15).setY(eyeY - 0.25);
    } else {
      ref.position.copy(this.anchor).addScaledVector(this.right, 1.15 * side).setY(eyeY + 0.05);
      hud.position.copy(this.anchor).addScaledVector(this.right, 1.15 * side).setY(eyeY - 0.65);
    }
    for (const o of [ref, hud]) {
      this.tmp.copy(this.headPos);
      this.tmp.y = o.position.y;
      o.lookAt(this.tmp);
    }
  }

  private togglePlay() {
    const v = session.reference;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  private restart() {
    const v = session.reference;
    if (!v) return;
    session.engine.resetRun();
    this.lastRefT = 0;
    v.currentTime = 0;
    v.play().catch(() => {});
  }

  /**
   * End of a run: pause, show the card with local stats right away, then fill
   * in the coach's verdict from /api/report. `force` skips the guard that
   * ignores runs where nobody was tracked (desktop testing, key G).
   */
  private finishRun(force = false) {
    const ref = session.reference;
    if (!ref || !this.reportEntity) return;
    const stats = session.engine.runStats();
    if (!force && stats.scoreTimeline.length < 4) {
      session.engine.resetRun();
      return;
    }
    ref.pause();
    const run = summarize(stats, session.engine.mode, session.title);
    this.report.show(run);
    this.placeReport();
    this.report.mesh.visible = true;
    this.overlay.root.visible = false;
    beaconInfo.report = this.report.status;
    logEvent(`run finished: grade ${run.grade}, avg ${run.avg}, peak ${run.peak}, ${stats.scoreTimeline.length} samples`);
    const token = ++this.reportToken;
    fetchReport(run)
      .then(
        (r) => token === this.reportToken && this.report.setReport(r),
        () => token === this.reportToken && this.report.setFailed(),
      )
      .finally(() => {
        beaconInfo.report = this.report.status;
        logEvent(`report ${this.report.status}`);
      });
  }

  private goAgain() {
    this.reportToken++;
    this.report.hide();
    this.overlay.root.visible = true;
    beaconInfo.report = 'none';
    logEvent('run restarted');
    this.restart();
  }

  /** Card in front of the user at reading distance, facing them. */
  private placeReport() {
    const o = this.reportEntity!.object3D!;
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldDirection(this.headDir);
    this.headDir.multiplyScalar(-1);
    this.headDir.y = 0;
    if (this.headDir.lengthSq() < 1e-4) this.headDir.set(0, 0, -1);
    this.headDir.normalize();
    o.position.copy(this.headPos).addScaledVector(this.headDir, 1.15);
    o.position.y = this.headPos.y - 0.08;
    this.tmp.copy(this.headPos);
    this.tmp.y = o.position.y;
    o.lookAt(this.tmp);
  }

  private cycleLayout() {
    const i = LAYOUTS.indexOf(session.layout);
    session.layout = LAYOUTS[(i + 1) % LAYOUTS.length];
    this.layoutPanels();
  }

  private handleInput(delta: number) {
    const right = this.input.xr.gamepads.right;
    const left = this.input.xr.gamepads.left;
    const kb = this.input.keyboard;

    const a = right?.getButtonDown(InputComponent.A_Button) || kb.getKeyDown('Space');
    const b = right?.getButtonDown(InputComponent.B_Button) || kb.getKeyDown('KeyR');
    if (this.report.mesh.visible) {
      if (a || b) this.goAgain();
    } else {
      if (a) this.togglePlay();
      if (b) this.restart();
    }
    if (kb.getKeyDown('KeyG')) this.finishRun(true);
    if (left?.getButtonDown(InputComponent.X_Button) || kb.getKeyDown('KeyL')) this.cycleLayout();
    if (left?.getButtonDown(InputComponent.Y_Button) || kb.getKeyDown('KeyC')) {
      this.overlay.feedVisible = !this.overlay.feedVisible;
    }

    // Calibration: align the skeleton with the reflection
    const c = session.calibration;
    const rs = right?.getAxesValues(InputComponent.Thumbstick);
    const ls = left?.getAxesValues(InputComponent.Thumbstick);
    let dFov = 0, dx = 0, dy = 0;
    if (rs && Math.abs(rs.y) > DEADZONE) dFov = -rs.y * 15 * delta;
    if (rs && Math.abs(rs.x) > DEADZONE) dx = rs.x * 0.4 * delta;
    if (ls && Math.abs(ls.y) > DEADZONE) dy = -ls.y * 0.4 * delta;
    if (kb.getKeyPressed('BracketRight')) dFov += 15 * delta;
    if (kb.getKeyPressed('BracketLeft')) dFov -= 15 * delta;
    if (kb.getKeyPressed('ArrowRight')) dx += 0.4 * delta;
    if (kb.getKeyPressed('ArrowLeft')) dx -= 0.4 * delta;
    if (kb.getKeyPressed('ArrowUp')) dy += 0.4 * delta;
    if (kb.getKeyPressed('ArrowDown')) dy -= 0.4 * delta;
    if (dFov || dx || dy) {
      c.hfov = Math.min(140, Math.max(30, c.hfov + dFov));
      c.offsetX += dx;
      c.offsetY += dy;
      this.applyCalibration();
      saveCalibration(c);
    }
  }

  update(delta: number): void {
    if (!session.started) return;
    if (!this.built) this.build();
    // Back on the setup screen the user may pick another video or camera.
    if (session.reference && session.reference !== this.boundRef) {
      this.boundRef = session.reference;
      this.refPanel?.setVideo(session.reference);
    }
    if (session.camera !== this.boundCam || session.engine.cameraSeesMirror !== this.boundSeesMirror) {
      this.bindCamera();
    }

    if (this.relayoutIn > 0 && --this.relayoutIn === 0) {
      this.layoutPanels();
      this.applyCalibration();
    }

    const now = performance.now();
    session.engine.tick(now);
    this.refPanel?.refreshVideo(now);
    this.overlay.refreshVideo(now);
    this.handleInput(delta);

    // The reference loops; a jump from the end back to the start is a finished run.
    const refNow = session.reference!;
    const t = refNow.currentTime;
    if (!refNow.paused && !this.report.mesh.visible && this.lastRefT > refNow.duration - 1 && t < this.lastRefT - 1) {
      this.finishRun();
    }
    this.lastRefT = t;

    const engine = session.engine;
    if (engine.version !== this.lastVersion) {
      this.lastVersion = engine.version;
      this.overlay.draw(engine.state);
    }
    if (now - this.lastHudDraw > 250) {
      this.lastHudDraw = now;
      const ref = session.reference!;
      this.hud.draw(engine.state, {
        title: session.title,
        refTime: ref.currentTime,
        refDuration: ref.duration,
        paused: ref.paused,
        hint: HINT,
      });
    }
  }
}
