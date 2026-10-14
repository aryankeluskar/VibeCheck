/**
 * End-of-run report card: a world-space canvas panel shown when the reference
 * clip finishes a full play-through. The grade, averages and limb bars come
 * from local run stats immediately; the headline, persona and tips arrive from
 * /api/report (AI Gateway) a few seconds later.
 */

import { getGradeColors, type AIReport } from '../../app/components/report/types';
import type { SessionStats } from '../../app/lib/sessionStats';
import type { AppMode } from '../../app/shared/mode';
import { LIMBS } from './engine.js';
import { CanvasPanel, FONT, LIMB_NAMES, roundRect, scoreColor } from './panels.js';

type Grade = AIReport['grade'];

/** Same thresholds as /api/report, so the local grade never disagrees with the server. */
export function gradeFor(avg: number): Grade {
  if (avg >= 78) return 'S';
  if (avg >= 62) return 'A';
  if (avg >= 45) return 'B';
  if (avg >= 30) return 'C';
  return 'D';
}

export type RunSummary = {
  stats: SessionStats;
  mode: AppMode;
  title: string;
  avg: number;
  peak: number;
  grade: Grade;
  limbs: Record<string, number>;
};

export function summarize(stats: SessionStats, mode: AppMode, title: string): RunSummary {
  const t = stats.scoreTimeline;
  const avg = t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : 0;
  const limbs: Record<string, number> = {};
  for (const [k, { sum, count }] of Object.entries(stats.limbTotals)) {
    if (count) limbs[k] = Math.round(sum / count);
  }
  return { stats, mode, title, avg, peak: stats.peakScore, grade: gradeFor(avg), limbs };
}

export async function fetchReport(run: RunSummary): Promise<AIReport> {
  const res = await fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stats: run.stats, mode: run.mode, videoTitle: run.title }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`report ${res.status}`);
  return (await res.json()) as AIReport;
}

// Canvas is 1600x1000 px on a 0.96 x 0.6 m plane (~1670 px/m): 30 px body
// copy is ~1.8 cm tall, comfortably readable at arm's length on Quest 3.
const W = 1600;
const H = 1000;
const PAD = 72;
const COL = 600; // right column start

const INK = '#ffffff';
const INK_2 = 'rgba(255,255,255,0.78)';
const INK_3 = 'rgba(255,255,255,0.5)';
const SURFACE = 'rgba(7,9,16,0.94)';

export class ReportPanel {
  readonly panel = new CanvasPanel(0.96, 0.6, W, H, true);
  private run: RunSummary | null = null;
  private report: AIReport | null = null;
  private failed = false;

  get mesh() {
    return this.panel.mesh;
  }

  constructor() {
    // Canvas text uses whatever font is loaded at draw time; redraw once the
    // brand face arrives so the card never sticks on the fallback.
    document.fonts
      ?.load(`700 64px ${FONT}`)
      .then(() => {
        if (this.run) this.draw();
      })
      .catch(() => {});
  }

  show(run: RunSummary) {
    this.run = run;
    this.report = null;
    this.failed = false;
    this.draw();
  }

  hide() {
    this.run = null;
    this.report = null;
    this.panel.mesh.visible = false;
  }

  setReport(report: AIReport) {
    this.report = report;
    this.draw();
  }

  setFailed() {
    if (!this.run) return;
    this.failed = true;
    this.draw();
  }

  /** For the debug beacon. */
  get status() {
    if (!this.run) return 'none';
    return `${this.run.grade} ${this.report ? 'ready' : this.failed ? 'failed' : 'loading'}`;
  }

  private draw() {
    const run = this.run;
    if (!run) return;
    const { ctx } = this.panel;
    const grade = this.report?.grade ?? run.grade;
    const gc = getGradeColors(grade, run.mode);
    ctx.clearRect(0, 0, W, H);

    // Surface: near-opaque so text keeps its contrast over any passthrough
    // background; a hairline in the grade color carries the identity.
    ctx.fillStyle = SURFACE;
    roundRect(ctx, 0, 0, W, H, 48);
    ctx.fill();
    ctx.strokeStyle = gc.color;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.textBaseline = 'alphabetic';

    // Eyebrow row
    ctx.textAlign = 'left';
    ctx.font = `600 24px ${FONT}`;
    ctx.fillStyle = gc.color;
    spaced(ctx, run.mode === 'gym' ? 'FORM REPORT' : 'PERFORMANCE REPORT', PAD, PAD + 18, 4);
    ctx.textAlign = 'right';
    ctx.font = `500 24px ${FONT}`;
    ctx.fillStyle = INK_3;
    ctx.fillText(ellipsize(ctx, run.title, W - PAD * 2 - 520), W - PAD, PAD + 18);

    // Grade hero
    const gx = PAD + (COL - PAD * 2) / 2;
    ctx.textAlign = 'center';
    ctx.font = `700 380px ${FONT}`;
    ctx.save();
    ctx.shadowColor = gc.glow;
    ctx.shadowBlur = 60;
    ctx.fillStyle = gc.color;
    ctx.fillText(grade, gx, 500);
    ctx.restore();

    // Avg / peak
    stat(ctx, String(run.avg), 'AVG MATCH', gx - 110, 660);
    stat(ctx, String(run.peak), 'PEAK', gx + 110, 660);

    // Limb bars
    const limbs = LIMBS.filter((l) => run.limbs[l] !== undefined);
    let y = 760;
    for (const limb of limbs.slice(0, 5)) {
      const s = run.limbs[limb];
      ctx.textAlign = 'left';
      ctx.font = `500 22px ${FONT}`;
      ctx.fillStyle = INK_2;
      ctx.fillText(LIMB_NAMES[limb], PAD, y);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      roundRect(ctx, PAD + 140, y - 13, 260, 12, 6);
      ctx.fill();
      ctx.fillStyle = scoreColor(s);
      roundRect(ctx, PAD + 140, y - 13, Math.max(12, (260 * s) / 100), 12, 6);
      ctx.fill();
      ctx.textAlign = 'right';
      ctx.fillStyle = INK;
      ctx.font = `600 22px ${FONT}`;
      ctx.fillText(String(s), COL - PAD, y);
      y += 40;
    }

    // Right column: the coach's verdict
    const rx = COL + 24;
    const rw = W - PAD - rx;
    ctx.textAlign = 'left';
    if (this.report) {
      const r = this.report;
      ctx.font = `700 76px ${FONT}`;
      ctx.fillStyle = INK;
      // Headline cap height lines up with the top of the grade letter.
      let ty = 250;
      for (const line of balanced(ctx, r.headline, rw, 2)) {
        ctx.fillText(line, rx, ty);
        ty += 84;
      }
      ty += -84 + 64;
      ctx.font = `700 30px ${FONT}`;
      ctx.fillStyle = gc.color;
      spaced(ctx, r.persona.toUpperCase(), rx, ty, 2);
      ty += 50;
      ctx.font = `500 30px ${FONT}`;
      ctx.fillStyle = INK_2;
      ty = paragraph(ctx, r.personaDesc || r.summary, rx, ty, rw, 42, 2);

      ty += 48;
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = INK_3;
      spaced(ctx, run.mode === 'gym' ? 'FIX NEXT SET' : 'FIX NEXT RUN', rx, ty, 4);
      ty += 56;
      for (const tip of r.tips.slice(0, 3)) {
        ctx.fillStyle = gc.color;
        ctx.beginPath();
        ctx.arc(rx + 8, ty - 11, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `500 32px ${FONT}`;
        ctx.fillStyle = INK;
        ty = paragraph(ctx, tip, rx + 32, ty, rw - 32, 44, 2) + 20;
        if (ty > H - 200) break;
      }
    } else {
      ctx.font = `700 64px ${FONT}`;
      ctx.fillStyle = this.failed ? INK_2 : INK_3;
      ctx.fillText(this.failed ? 'Run complete' : 'Grading your run…', rx, 260);
      ctx.font = `500 30px ${FONT}`;
      ctx.fillStyle = INK_3;
      paragraph(
        ctx,
        this.failed
          ? 'The coach could not write a report this time. Your scores are on the left.'
          : 'Your coach is writing the report.',
        rx,
        320,
        rw,
        42,
        2,
      );
    }

    // Footer: the one action, as a controller keycap
    const fy = H - PAD - 8;
    ctx.textAlign = 'left';
    keycap(ctx, 'A', rx, fy, gc.color);
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText('Go again', rx + 68, fy);
    ctx.font = `500 24px ${FONT}`;
    ctx.fillStyle = INK_3;
    ctx.fillText('Trigger to move this card', rx + 260, fy);

    this.panel.texture.needsUpdate = true;
  }
}

function stat(ctx: CanvasRenderingContext2D, value: string, label: string, cx: number, y: number) {
  ctx.textAlign = 'center';
  ctx.font = `700 64px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(value, cx, y);
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = INK_3;
  spacedCentered(ctx, label, cx, y + 34, 3);
}

function keycap(ctx: CanvasRenderingContext2D, key: string, x: number, baseline: number, color: string) {
  const size = 48;
  const top = baseline - 36;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, x, top, size, size, 14);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = color;
  ctx.fillText(key, x + size / 2, baseline - 2);
  ctx.textAlign = 'left';
}

/** Small uppercase labels get positive tracking so letters don't crowd. */
function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

function spacedCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, tracking: number) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  ctx.textAlign = 'left';
  spaced(ctx, text, cx - (w - tracking) / 2, y, tracking);
  ctx.textAlign = 'center';
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function lines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxW) {
      out.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Draw wrapped text, ellipsizing the last allowed line. Returns the baseline after the last line. */
function paragraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines: number,
) {
  const all = lines(ctx, text, maxW);
  const shown = all.slice(0, maxLines);
  if (all.length > maxLines) shown[maxLines - 1] = ellipsize(ctx, `${shown[maxLines - 1]} …`, maxW);
  for (const l of shown) {
    ctx.fillText(l, x, y);
    y += lineH;
  }
  return y;
}

/** Headline wrap that evens out two lines instead of leaving one word alone. */
function balanced(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const greedy = lines(ctx, text, maxW);
  if (greedy.length !== 2) return greedy.slice(0, maxLines).map((l) => ellipsize(ctx, l, maxW));
  const words = text.split(/\s+/).filter(Boolean);
  let best = greedy;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const wa = ctx.measureText(a).width;
    const wb = ctx.measureText(b).width;
    if (wa > maxW || wb > maxW) continue;
    if (Math.abs(wa - wb) < bestDiff) {
      bestDiff = Math.abs(wa - wb);
      best = [a, b];
    }
  }
  return best;
}
