/**
 * Hands-only controls: everything the controller buttons do, as spatial
 * buttons you point at and pinch (Quest hand tracking turns a pinch into a
 * select on the hand's target ray; a controller trigger works the same way).
 *
 *   under the HUD:      Play/Pause · Restart · Layout · Camera · Calibrate · End run
 *   calibrate mode:     Size − / + · Nearer / Farther · Done
 *                       Left · Right · Up · Down · current values
 *   on the report card: Go again
 *
 * Body gesture through the camera: raise both hands above your head and hold
 * for a second to resume a paused clip, or to start the next run from the
 * report card. It's off while the clip plays, because dance moves raise both
 * hands all the time. The button it will press fills up as a cue.
 *
 * Each button is its own RayInteractable entity; IWSDK's InputSystem adds
 * Pressed on pinch/trigger and this system calls the same MirrorSystem
 * methods the controller buttons call. Agents press them by name with
 * `mirrorCoach.agent.do('press', {button})` (see `buttons` for the list).
 */

import { createSystem, Hovered, Pressed, RayInteractable, Vector3, type Entity, type Object3D } from '@iwsdk/core';
import { registerAction } from './agent.js';
import { logEvent } from './events.js';
import { CanvasPanel, FONT, roundRect } from './panels.js';
import { session } from './session.js';

/** What the buttons drive. MirrorSystem passes its own methods (the controller paths). */
export type MirrorHooks = {
  togglePlay(): void;
  restart(): void;
  cycleLayout(): void;
  toggleFeed(): void;
  finishRun(): void;
  goAgain(): void;
  /** Re-apply and save session.calibration after a change. */
  calibrationChanged(): void;
  paused(): boolean;
  feedOn(): boolean;
  reportShown(): boolean;
};

const PX_PER_M = 1600;
const CYAN = '#22d3ee';
/** Seconds both hands must stay above the head. */
const HANDS_UP_S = 1;
const GESTURE_COOLDOWN_S = 2;
const REPEAT_DELAY_S = 0.45;
const REPEAT_EVERY_S = 0.08;

type Source = 'hand' | 'agent' | 'gesture';

class Button {
  readonly panel: CanvasPanel;
  entity: Entity | null = null;
  hovered = false;
  pressed = false;
  /** Toggle-style highlight (camera feed on, calibrating). */
  active = false;
  /** 0..1 fill while a body gesture is about to press this button. */
  progress = 0;
  shown = true;
  // Last drawn state; compared by reference so an unchanged frame allocates nothing.
  private drawn = { label: '', sub: '', flags: -1, progress: -1 };

  constructor(
    readonly id: string,
    public label: string,
    public sub: string,
    widthM: number,
    heightM: number,
    readonly run: (() => void) | null,
    readonly repeat = false,
  ) {
    this.panel = new CanvasPanel(widthM, heightM, Math.round(widthM * PX_PER_M), Math.round(heightM * PX_PER_M), true);
    this.panel.mesh.name = `button:${id}`;
  }

  get mesh() {
    return this.panel.mesh;
  }

  set(label: string, sub: string, active: boolean) {
    this.label = label;
    this.sub = sub;
    this.active = active;
  }

  /** Redraw only when something visible changed. */
  redraw() {
    const p = Math.round(this.progress * 20);
    const flags = (this.hovered ? 1 : 0) | (this.pressed ? 2 : 0) | (this.active ? 4 : 0);
    const d = this.drawn;
    if (d.label === this.label && d.sub === this.sub && d.flags === flags && d.progress === p) return;
    d.label = this.label;
    d.sub = this.sub;
    d.flags = flags;
    d.progress = p;
    const { ctx, canvas } = this.panel;
    const w = canvas.width, h = canvas.height;
    const r = Math.min(28, h / 4);
    const interactive = !!this.run;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = this.pressed ? 'rgba(34,211,238,0.92)' : 'rgba(8,10,18,0.9)';
    roundRect(ctx, 3, 3, w - 6, h - 6, r);
    ctx.fill();
    if (!this.pressed && (this.hovered || this.active)) {
      ctx.fillStyle = this.hovered ? 'rgba(34,211,238,0.22)' : 'rgba(34,211,238,0.12)';
      ctx.fill();
    }
    if (this.progress > 0 && !this.pressed) {
      ctx.save();
      roundRect(ctx, 3, 3, w - 6, h - 6, r);
      ctx.clip();
      ctx.fillStyle = 'rgba(34,211,238,0.45)';
      ctx.fillRect(0, 0, w * this.progress, h);
      ctx.restore();
    }
    roundRect(ctx, 3, 3, w - 6, h - 6, r);
    ctx.strokeStyle = this.hovered || this.pressed || this.active ? CYAN : 'rgba(34,211,238,0.35)';
    ctx.lineWidth = this.hovered ? 6 : interactive ? 3 : 2;
    if (interactive || this.active) ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const ink = this.pressed ? '#04121a' : '#ffffff';
    const labelPx = Math.round(h * (this.sub ? 0.3 : 0.36));
    ctx.font = `700 ${labelPx}px ${FONT}`;
    ctx.fillStyle = ink;
    ctx.fillText(this.label, w / 2, this.sub ? h * 0.52 : h * 0.62, w - 24);
    if (this.sub) {
      ctx.font = `600 ${Math.round(h * 0.15)}px ${FONT}`;
      ctx.fillStyle = this.pressed ? 'rgba(4,18,26,0.75)' : 'rgba(255,255,255,0.6)';
      ctx.fillText(this.sub, w / 2, h * 0.8, w - 24);
    }
    this.panel.texture.needsUpdate = true;
  }
}

type PointerTarget = Object3D & { pointerEvents?: string };

export class ControlsSystem extends createSystem({
  pressed: { required: [RayInteractable, Pressed] },
  hovered: { required: [RayInteractable, Hovered] },
}) {
  private hooks: MirrorHooks | null = null;
  private readonly byEntity = new Map<Entity, Button>();
  private bar: Button[] = [];
  private pad: Button[] = [];
  private readout!: Button;
  private playBtn!: Button;
  private goAgainBtn!: Button;
  private all: Button[] = [];
  private reportRoot: Object3D | null = null;
  private calibrating = false;
  /** The feed was off when calibration started; turn it back off on Done. */
  private feedForCalibration = false;
  private held: Button | null = null;
  private heldFor = 0;
  private nextRepeat = 0;
  private handsUpFor = 0;
  private cooldown = 0;
  private gestureTarget: Button | null = null;
  private calText = '';
  private tmp!: Vector3;

  init(): void {
    this.tmp = new Vector3();
    this.queries.pressed.subscribe('qualify', (e) => {
      const b = this.byEntity.get(e);
      if (!b) return;
      b.pressed = true;
      if (b.shown && b.run) {
        this.activate(b, 'hand');
        if (b.repeat) {
          this.held = b;
          this.heldFor = 0;
          this.nextRepeat = REPEAT_DELAY_S;
        }
      }
    });
    this.queries.pressed.subscribe('disqualify', (e) => {
      const b = this.byEntity.get(e);
      if (!b) return;
      b.pressed = false;
      if (this.held === b) this.held = null;
    });
    this.queries.hovered.subscribe('qualify', (e) => {
      const b = this.byEntity.get(e);
      if (b) b.hovered = true;
    });
    this.queries.hovered.subscribe('disqualify', (e) => {
      const b = this.byEntity.get(e);
      if (b) b.hovered = false;
    });

    registerAction(
      'press',
      'Press an on-screen button like a hand pinch: {button: "play" | "restart" | "layout" | "camera" | "calibrate" | "end" | "goAgain" | calibrate mode: "size-" | "size+" | "nearer" | "farther" | "left" | "right" | "up" | "down" | "done"}',
      (a: { button: string }) => {
        const b = this.all.find((x) => x.id === a?.button);
        if (!b || !b.run) throw new Error(`Unknown button "${a?.button}". Buttons: ${this.all.filter((x) => x.run).map((x) => x.id).join(', ')}`);
        if (!b.shown) {
          const on = this.all.filter((x) => x.run && x.shown).map((x) => x.id);
          throw new Error(`Button "${b.id}" is not on screen now. On screen: ${on.join(', ') || 'none (start the session first)'}`);
        }
        this.activate(b, 'agent');
        return this.describe(b);
      },
    );
    registerAction('buttons', 'On-screen buttons: id, label, shown, hovered, pressed, world position (m)', () =>
      this.all.filter((b) => b.run).map((b) => this.describe(b)),
    );
  }

  /** Called by MirrorSystem once its HUD and report entities exist. */
  attach(hudEntity: Entity, reportEntity: Entity, hooks: MirrorHooks) {
    this.hooks = hooks;
    this.reportRoot = reportEntity.object3D ?? null;

    // Main bar: six buttons the width of the HUD (0.9 m), just under it.
    const gap = 0.012;
    const bw = (0.9 - 5 * gap) / 6;
    const bh = 0.1;
    const barY = -0.25 - 0.02 - bh / 2;
    this.playBtn = new Button('play', 'Pause', 'PLAYING', bw, bh, () => this.onPlay());
    this.bar = [
      this.playBtn,
      new Button('restart', 'Restart', 'FROM 0:00', bw, bh, () => (hooks.reportShown() ? hooks.goAgain() : hooks.restart())),
      new Button('layout', 'Layout', 'LEFT', bw, bh, () => hooks.cycleLayout()),
      new Button('camera', 'Camera', 'FEED OFF', bw, bh, () => hooks.toggleFeed()),
      new Button('calibrate', 'Calibrate', 'SIZE · SPOT', bw, bh, () => this.setCalibrating(true)),
      new Button('end', 'End run', 'REPORT', bw, bh, () => {
        if (!hooks.reportShown()) hooks.finishRun();
      }),
    ];
    this.bar.forEach((b, i) => this.mount(b, hudEntity, -0.45 + bw / 2 + i * (bw + gap), barY));

    // Calibrate pad: replaces the bar while calibrating; two rows of five.
    const pw = (0.9 - 4 * gap) / 5;
    const row2 = barY - bh - gap;
    const nudge = (k: 'hfov' | 'offsetX' | 'pitch' | 'distance', d: number, min: number, max: number) => () => {
      const c = session.calibration;
      // A hand-set depth replaces the live measurement from the body.
      if (k === 'distance') c.autoDistance = false;
      c[k] = Math.min(max, Math.max(min, Math.round((c[k] + d) * 1000) / 1000));
      hooks.calibrationChanged();
      this.refreshReadout();
    };
    this.readout = new Button('values', '', '', pw, bh, null);
    this.pad = [
      new Button('size-', 'Size −', 'SMALLER', pw, bh, nudge('hfov', -1, 30, 140), true),
      new Button('size+', 'Size +', 'BIGGER', pw, bh, nudge('hfov', 1, 30, 140), true),
      new Button('nearer', 'Nearer', 'DEPTH', pw, bh, nudge('distance', -0.1, 0.5, 8), true),
      new Button('farther', 'Farther', 'DEPTH', pw, bh, nudge('distance', 0.1, 0.5, 8), true),
      new Button('done', 'Done', 'SAVE', pw, bh, () => this.setCalibrating(false)),
      new Button('left', 'Left', 'MOVE', pw, bh, nudge('offsetX', -0.01, -1, 1), true),
      new Button('right', 'Right', 'MOVE', pw, bh, nudge('offsetX', 0.01, -1, 1), true),
      // Up/Down tilt (camera pitch): an angle lines up at any mirror distance.
      new Button('up', 'Up', 'TILT', pw, bh, nudge('pitch', -0.5, -30, 30), true),
      new Button('down', 'Down', 'TILT', pw, bh, nudge('pitch', 0.5, -30, 30), true),
      this.readout,
    ];
    this.pad.forEach((b, i) => this.mount(b, hudEntity, -0.45 + pw / 2 + (i % 5) * (pw + gap), i < 5 ? barY : row2));

    // Report card footer (card is 0.96 x 0.6 m; see report.ts footer).
    // Left edge at the right column (canvas x 624 of 1600), centred on the footer row.
    this.goAgainBtn = new Button('goAgain', 'Go again', '', 0.2, 0.06, () => hooks.goAgain());
    this.mount(this.goAgainBtn, reportEntity, -0.1056 + 0.1, -0.246);

    this.all = [...this.bar, ...this.pad, this.goAgainBtn];
    this.refreshReadout();
    this.setCalibrating(false);
  }

  private mount(b: Button, parent: Entity, x: number, y: number) {
    b.mesh.position.set(x, y, 0.006);
    const e = this.world.createTransformEntity(b.mesh, parent);
    if (b.run) {
      e.addComponent(RayInteractable);
      this.byEntity.set(e, b);
    }
    b.entity = e;
  }

  private onPlay() {
    const h = this.hooks!;
    if (h.reportShown()) h.goAgain();
    else h.togglePlay();
  }

  private setCalibrating(on: boolean) {
    if (on !== this.calibrating) logEvent(on ? 'calibrate mode on' : 'calibrate mode off (saved)');
    this.calibrating = on;
    for (const b of this.bar) b.shown = !on;
    for (const b of this.pad) b.shown = on;
    // Seeing the camera feed under the skeleton makes alignment much easier.
    const h = this.hooks;
    if (on && h && !h.feedOn()) {
      h.toggleFeed();
      this.feedForCalibration = true;
    } else if (!on && h && this.feedForCalibration) {
      if (h.feedOn()) h.toggleFeed();
      this.feedForCalibration = false;
    }
  }

  private refreshReadout() {
    const c = session.calibration;
    const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
    this.readout.set(`${Math.round(c.hfov)}° · ${c.distance.toFixed(1)} m`, `X ${sign(c.offsetX)}  ${c.pitch.toFixed(1)}° down`, false);
    this.calText = `Calibrating: ${Math.round(c.hfov)}°, ${c.distance.toFixed(1)} m, x ${sign(c.offsetX)}, pitch ${c.pitch.toFixed(1)}°`;
  }

  private activate(b: Button, source: Source) {
    logEvent(`press ${b.id} (${source})`);
    b.run!();
  }

  private describe(b: Button) {
    b.mesh.getWorldPosition(this.tmp);
    return {
      id: b.id,
      label: b.label,
      shown: b.shown,
      hovered: b.hovered,
      pressed: b.pressed,
      world: [+this.tmp.x.toFixed(3), +this.tmp.y.toFixed(3), +this.tmp.z.toFixed(3)],
    };
  }

  /** Line for the HUD status row: what the hands can do right now. */
  get hint(): string {
    if (this.calibrating) return this.calText;
    if (this.gestureTarget && this.handsUpFor > 0) return 'Hands up: hold…';
    if (this.hooks?.paused()) return 'Paused · pinch Play or raise both hands';
    return 'Point and pinch the buttons below';
  }

  update(delta: number): void {
    const h = this.hooks;
    if (!h) return;
    const report = h.reportShown();

    // Hidden things must not take rays (three's raycast ignores `visible`).
    for (let i = 0; i < this.all.length; i++) {
      const b = this.all[i];
      if (b === this.goAgainBtn) b.shown = report;
      const shown = b.shown;
      b.mesh.visible = shown;
      (b.mesh as PointerTarget).pointerEvents = shown ? 'auto' : 'none';
    }
    if (this.reportRoot) (this.reportRoot as PointerTarget).pointerEvents = report ? 'auto' : 'none';

    // Hold-to-repeat on the calibration nudges.
    if (this.held) {
      if (!this.held.shown) this.held = null;
      else {
        this.heldFor += delta;
        if (this.heldFor >= this.nextRepeat) {
          this.nextRepeat += REPEAT_EVERY_S;
          this.held.run!();
        }
      }
    }

    this.gesture(delta, report);

    // Labels that follow app state.
    const paused = h.paused();
    this.playBtn.set(report ? 'Go again' : paused ? 'Play' : 'Pause', report ? 'NEXT RUN' : paused ? 'OR HANDS UP' : 'PLAYING', paused);
    this.bar[2].set('Layout', session.layout === 'left' ? 'LEFT' : session.layout === 'top' ? 'TOP' : 'RIGHT', false);
    this.bar[3].set('Camera', h.feedOn() ? 'FEED ON' : 'FEED OFF', h.feedOn());
    for (let i = 0; i < this.all.length; i++) if (this.all[i].mesh.visible) this.all[i].redraw();
  }

  /**
   * Both wrists above the shoulder line (by the same 0.1 margin as the 2D
   * app's gestureControl "hands above head") for HANDS_UP_S presses Play when
   * paused, or Go again on the report card. Allocation-free.
   */
  private gesture(delta: number, report: boolean) {
    const h = this.hooks!;
    this.cooldown = Math.max(0, this.cooldown - delta);
    const target = this.calibrating ? null : report ? this.goAgainBtn : h.paused() ? this.playBtn : null;
    if (target !== this.gestureTarget) {
      if (this.gestureTarget) this.gestureTarget.progress = 0;
      this.gestureTarget = target;
      this.handsUpFor = 0;
    }
    if (!target) return;
    let up = false;
    const live = session.engine.state.live;
    if (live && this.cooldown === 0) {
      const ls = live[11], rs = live[12], lw = live[15], rw = live[16];
      if (seen(ls) && seen(rs) && seen(lw) && seen(rw)) {
        const top = Math.min(ls.y, rs.y) - 0.1;
        up = lw.y < top && rw.y < top;
      }
    }
    this.handsUpFor = up ? this.handsUpFor + delta : 0;
    target.progress = Math.min(1, this.handsUpFor / HANDS_UP_S);
    if (this.handsUpFor >= HANDS_UP_S) {
      this.handsUpFor = 0;
      target.progress = 0;
      this.cooldown = GESTURE_COOLDOWN_S;
      logEvent('gesture: both hands up');
      this.activate(target, 'gesture');
    }
  }
}

function seen(p: { visibility?: number } | undefined): boolean {
  return !!p && (p.visibility ?? 0) >= 0.5;
}
