/**
 * Procedural panels for the mirror coach, drawn with 2D canvases and shown
 * as textures on planes:
 *  - OverlayPanel: head-locked, transparent; skeleton + limb labels drawn in
 *    camera-image coordinates so they land on the user's reflection.
 *  - ReferencePanel: the reference dancer video.
 *  - HudPanel: score, coach line, per-limb bars, status.
 */

import {
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  VideoTexture,
} from '@iwsdk/core';
import { LIMBS, type EngineState, type NormalizedLandmark } from './engine.js';

const NECK = 33;
const CONNECTIONS: [number, number][] = [
  [0, NECK], [NECK, 11], [NECK, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
];

// Reflection-space landmark indices → the user's real limb (labels are swapped
// in a mirror: MediaPipe's "left" wrist on a reflection is the user's right).
const LIMB_OF_SEGMENT: Record<string, string> = {
  '11-13': 'rightArm', '13-15': 'rightArm',
  '12-14': 'leftArm', '14-16': 'leftArm',
  '23-25': 'rightLeg', '25-27': 'rightLeg', '27-31': 'rightLeg',
  '24-26': 'leftLeg', '26-28': 'leftLeg', '28-32': 'leftLeg',
  '11-12': 'torso', '11-23': 'torso', '12-24': 'torso', '23-24': 'torso',
};
const LABEL_ANCHOR: Record<string, number> = {
  rightArm: 13, leftArm: 14, rightLeg: 25, leftLeg: 26,
};
export const LIMB_NAMES: Record<string, string> = {
  leftArm: 'Left arm', rightArm: 'Right arm', leftLeg: 'Left leg', rightLeg: 'Right leg', torso: 'Torso',
};

const FONT = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';

export function scoreColor(score: number | undefined): string {
  if (score === undefined) return '#9ca3af';
  if (score >= 75) return '#22c55e';
  if (score >= 50) return '#eab308';
  return '#ef4444';
}

class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;

  constructor(widthM: number, heightM: number, pxW: number, pxH: number, transparent: boolean) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent,
      side: DoubleSide,
      depthWrite: !transparent,
    });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), material);
  }
}

function landmarkWithNeck(lm: NormalizedLandmark[]): NormalizedLandmark[] {
  const out = lm.slice();
  const l = lm[11], r = lm[12];
  if (l && r) {
    out[NECK] = {
      x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2,
      visibility: Math.min(l.visibility ?? 0, r.visibility ?? 0),
    };
  }
  return out;
}

const visible = (p: NormalizedLandmark | undefined) => !!p && (p.visibility ?? 0) >= 0.3;

/**
 * three's VideoTexture only refreshes from requestVideoFrameCallback, which
 * runs in the window's rendering step. That step (like window rAF) can stop
 * during an immersive session on Quest, freezing the picture while audio
 * plays on. Called from the XR frame loop, this re-uploads at most ~30 Hz.
 */
function refreshVideoTexture(texture: VideoTexture | null, nowMs: number, last: { t: number }) {
  const video = texture?.image as HTMLVideoElement | undefined;
  if (!texture || !video || video.readyState < 2) return;
  if (nowMs - last.t < (video.paused ? 250 : 33)) return;
  last.t = nowMs;
  texture.needsUpdate = true;
}

/**
 * Head-locked overlay. The headset's passthrough camera moves with the head,
 * so a plane fixed in head space covering the camera's field of view keeps
 * camera-image coordinates registered with what the user sees.
 */
export class OverlayPanel {
  readonly root = new Group();
  private readonly panel: CanvasPanel;
  private readonly feed: Mesh;
  private feedTexture: VideoTexture | null = null;
  private mirrored = false;

  constructor() {
    this.panel = new CanvasPanel(1, 1, 1024, 768, true);
    this.panel.mesh.renderOrder = 999;
    (this.panel.mesh.material as MeshBasicMaterial).depthTest = false;
    this.feed = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false }),
    );
    this.feed.renderOrder = 998;
    this.feed.position.z = -0.001;
    this.feed.visible = false;
    this.root.add(this.feed, this.panel.mesh);
  }

  /** Show the raw camera feed under the skeleton (alignment aid / desktop). */
  setFeed(video: HTMLVideoElement | null, mirrored: boolean) {
    this.feedTexture?.dispose();
    this.feedTexture = video ? new VideoTexture(video) : null;
    if (this.feedTexture) this.feedTexture.colorSpace = SRGBColorSpace;
    const mat = this.feed.material as MeshBasicMaterial;
    mat.map = this.feedTexture;
    mat.needsUpdate = true;
    this.mirrored = mirrored;
  }

  private readonly feedRefresh = { t: 0 };
  /** Keep the camera feed live in XR; see refreshVideoTexture. */
  refreshVideo(nowMs: number) {
    if (this.feed.visible) refreshVideoTexture(this.feedTexture, nowMs, this.feedRefresh);
  }

  get feedVisible() {
    return this.feed.visible;
  }
  set feedVisible(v: boolean) {
    this.feed.visible = v && !!this.feedTexture;
  }

  /** Size/position the plane to cover the camera FOV at `distance` metres. */
  layout(distance: number, hfovDeg: number, aspect: number, offsetX: number, offsetY: number) {
    const width = 2 * distance * Math.tan((hfovDeg * Math.PI) / 360);
    const height = width / aspect;
    this.root.position.set(offsetX, offsetY, -distance);
    this.panel.mesh.scale.set(width, height, 1);
    this.feed.scale.set((this.mirrored ? -1 : 1) * width, height, 1);
    const px = 1024;
    const py = Math.round(px / aspect);
    if (this.panel.canvas.height !== py) this.panel.canvas.height = py;
  }

  draw(state: EngineState) {
    const { ctx, canvas } = this.panel;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (state.ghost) this.drawSkeleton(state.ghost, w, h, null, true);
    if (state.live) {
      this.drawSkeleton(state.live, w, h, state.limbScores, false);
      this.drawLabels(state, w, h);
    } else if (state.status === 'Tracking') {
      ctx.font = `600 34px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText('Step back so the mirror shows your whole body', w / 2, h * 0.9);
    }
    this.panel.texture.needsUpdate = true;
  }

  private drawSkeleton(
    lm: NormalizedLandmark[],
    w: number,
    h: number,
    limbScores: Record<string, number> | null,
    ghost: boolean,
  ) {
    const ctx = this.panel.ctx;
    const pts = landmarkWithNeck(lm);
    ctx.save();
    ctx.lineCap = 'round';
    if (ghost) {
      ctx.setLineDash([14, 12]);
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    }
    for (const [a, b] of CONNECTIONS) {
      const pa = pts[a], pb = pts[b];
      if (!visible(pa) || !visible(pb)) continue;
      if (!ghost) {
        const limb = LIMB_OF_SEGMENT[`${a}-${b}`];
        ctx.strokeStyle = limb && limbScores ? scoreColor(limbScores[limb]) : '#22d3ee';
        ctx.lineWidth = 9;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    if (!ghost) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      for (const i of [0, NECK, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
        const p = pts[i];
        if (!visible(p)) continue;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawLabels(state: EngineState, w: number, h: number) {
    const ctx = this.panel.ctx;
    const live = state.live!;
    ctx.save();
    ctx.font = `700 26px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const limb of Object.keys(LABEL_ANCHOR)) {
      const p = live[LABEL_ANCHOR[limb]];
      const s = state.limbScores[limb];
      if (!visible(p) || s === undefined) continue;
      // Push labels outward from the body centre so they don't cover the arm
      const outward = p.x < 0.5 ? -1 : 1;
      const x = p.x * w + outward * 22;
      const y = p.y * h;
      const text = `${LIMB_NAMES[limb]} ${s}`;
      const tw = ctx.measureText(text).width;
      ctx.textAlign = outward < 0 ? 'right' : 'left';
      const bx = outward < 0 ? x - tw - 10 : x - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, y - 18, tw + 20, 36);
      ctx.fillStyle = scoreColor(s);
      ctx.fillText(text, x, y + 1);
    }
    // Posture label above the head
    const nose = live[0];
    if (visible(nose) && state.targetPose) {
      ctx.textAlign = 'center';
      ctx.font = `700 30px ${FONT}`;
      const text = `TARGET: ${state.targetPose.toUpperCase()}`;
      const tw = ctx.measureText(text).width;
      const y = Math.max(30, nose.y * h - 80);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(nose.x * w - tw / 2 - 12, y - 22, tw + 24, 44);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, nose.x * w, y + 1);
    }
    ctx.restore();
  }
}

/** The reference dancer video on a plane with a dark backing frame. */
export class ReferencePanel {
  readonly root = new Group();
  private readonly screen: Mesh;
  private readonly backing: Mesh;
  private readonly texture: VideoTexture;

  constructor(video: HTMLVideoElement, widthM = 1.1) {
    this.texture = new VideoTexture(video);
    this.texture.colorSpace = SRGBColorSpace;
    this.screen = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.texture, side: DoubleSide }));
    this.backing = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x05060a, side: DoubleSide }));
    this.backing.position.z = -0.005;
    this.root.add(this.backing, this.screen);
    this.resize(video, widthM);
    video.addEventListener('loadedmetadata', () => this.resize(video, widthM));
  }

  private readonly refresh = { t: 0 };
  /** Keep the reference picture live in XR; see refreshVideoTexture. */
  refreshVideo(nowMs: number) {
    refreshVideoTexture(this.texture, nowMs, this.refresh);
  }

  resize(video: HTMLVideoElement, widthM: number) {
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    this.screen.scale.set(widthM, widthM / aspect, 1);
    this.backing.scale.set(widthM + 0.04, widthM / aspect + 0.04, 1);
  }
}

/** Score, coach line, per-limb bars and status. */
export class HudPanel {
  readonly panel: CanvasPanel;
  get mesh() {
    return this.panel.mesh;
  }

  constructor() {
    this.panel = new CanvasPanel(0.9, 0.5, 1152, 640, true);
  }

  draw(state: EngineState, extra: { title: string; refTime: number; refDuration: number; paused: boolean; hint: string }) {
    const { ctx, canvas } = this.panel;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Card
    ctx.fillStyle = 'rgba(8,10,18,0.82)';
    roundRect(ctx, 0, 0, w, h, 36);
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Score
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = scoreColor(state.live ? state.score : undefined);
    ctx.font = `800 150px ${FONT}`;
    ctx.fillText(state.live ? String(state.score) : '--', 40, 170);
    ctx.font = `600 26px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('MATCH', 46, 210);

    // Title + time
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncate(ctx, extra.title || 'Mirror Coach', w - 330), 300, 70);
    ctx.font = `500 24px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(
      `${extra.paused ? 'PAUSED' : 'PLAYING'}  ${fmt(extra.refTime)} / ${fmt(extra.refDuration)}`,
      300,
      110,
    );

    // Limb bars
    let y = 160;
    for (const limb of LIMBS) {
      const s = state.limbScores[limb];
      ctx.font = `600 24px ${FONT}`;
      ctx.fillStyle = state.worstLimb === limb ? '#ffffff' : 'rgba(255,255,255,0.7)';
      ctx.fillText(LIMB_NAMES[limb], 300, y);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(470, y - 18, 560, 18);
      if (s !== undefined) {
        ctx.fillStyle = scoreColor(s);
        ctx.fillRect(470, y - 18, (560 * s) / 100, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(String(s), 1045, y);
      }
      y += 38;
    }

    // Coach line
    ctx.font = `700 36px ${FONT}`;
    ctx.fillStyle = '#f0abfc';
    wrap(ctx, state.coachLine ? `“${state.coachLine}”` : 'Your coach will chime in once the video plays.', 40, 410, w - 80, 46, 3);

    // Status
    ctx.font = `500 22px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`${state.status} · ${state.trackingFps} fps · ${extra.hint}`, 40, h - 30);

    this.panel.texture.needsUpdate = true;
  }
}

function fmt(t: number) {
  if (!isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = word;
      if (++lines >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
