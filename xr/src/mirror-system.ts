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
 * Desktop keys: Space, R, L, C, arrows/[ ] for calibration.
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
import { beaconInfo } from './beacon.js';
import { LAYOUTS, saveCalibration, session } from './session.js';

const HINT = 'A play · B restart · X layout · Y camera · sticks calibrate';
const DEADZONE = 0.25;

export class MirrorSystem extends createSystem({}) {
  private overlay!: OverlayPanel;
  private hud!: HudPanel;
  private refPanel: ReferencePanel | null = null;
  private refEntity: Entity | null = null;
  private hudEntity: Entity | null = null;
  private built = false;
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

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        beaconInfo.xrVisibility = String(state);
        // Re-anchor panels in front of the user a few frames into the session,
        // once the headset pose is real.
        if (state !== VisibilityState.NonImmersive) this.relayoutIn = 15;
      }),
    );
  }

  private build() {
    const ref = session.reference!;
    // Head-locked overlay: parented to the head so camera-image coordinates
    // stay registered with the passthrough view (exact view alignment).
    this.world.createTransformEntity(this.overlay.root, this.world.playerHeadEntity);
    this.overlay.setFeed(session.camera, !session.engine.cameraSeesMirror);
    this.applyCalibration();
    // A camera facing the user (laptop webcam, emulator) has no passthrough
    // behind it, so show the feed; a headset camera looking at a mirror doesn't
    // need it (the real reflection is visible). Y toggles either way.
    this.overlay.feedVisible = !session.engine.cameraSeesMirror;

    this.refPanel = new ReferencePanel(ref);
    this.refEntity = this.world.createTransformEntity(this.refPanel.root);
    this.hudEntity = this.world.createTransformEntity(this.hud.mesh);
    for (const e of [this.refEntity, this.hudEntity]) {
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

    // Mirror centre ~1.4 m ahead; panels sit just in front of the mirror plane.
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
    v.currentTime = 0;
    v.play().catch(() => {});
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

    if (right?.getButtonDown(InputComponent.A_Button) || kb.getKeyDown('Space')) this.togglePlay();
    if (right?.getButtonDown(InputComponent.B_Button) || kb.getKeyDown('KeyR')) this.restart();
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

    if (this.relayoutIn > 0 && --this.relayoutIn === 0) {
      this.layoutPanels();
      this.applyCalibration();
    }

    const now = performance.now();
    session.engine.tick(now);
    this.handleInput(delta);

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
