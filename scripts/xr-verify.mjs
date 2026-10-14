#!/usr/bin/env node
/**
 * End-to-end visual check of /xr without a headset: headless Chromium, the
 * IWER Quest 3 emulator (auto-injected on localhost), and a fake camera that
 * plays a dancer clip, so tracking, scoring and the coach run for real.
 *
 * Flow: setup screen → allow camera → Enter Mirror (MR) → coaching → pinch
 * buttons (emulated controller ray select + the `press` agent action) → the
 * clip finishes a play-through → report card → select "Go again" on the card.
 * Screenshots and a JSON summary go to .tools/xr-verify/.
 *
 *   PORT=3100 pnpm dev && pnpm build:xr         # serve /xr locally first
 *   node scripts/xr-verify.mjs                  # Rat Dance (15 s) as reference and camera
 *   node scripts/xr-verify.mjs --clip <id> --finish-after 12   # longer clips: end the run early
 *   node scripts/xr-verify.mjs --base https://<preview>.vercel.app
 *
 * Needs ffmpeg and the Playwright Chromium that xr/ already installs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "xr/package.json"))("playwright");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg("base", "http://localhost:3100");
const clip = arg("clip", "FILJpZiAFo0");
const finishAfter = Number(arg("finish-after", 0));
const out = join(root, ".tools/xr-verify");
mkdirSync(out, { recursive: true });

// Fake camera: the clip mirrored (as if the user were copying it), letterboxed
// to the Quest's 4:3 camera aspect.
const camera = arg("camera", join(out, `camera-${clip}.y4m`));
if (!existsSync(camera)) {
  const src = join(root, ".tools/out", `${clip}.mp4`);
  const input = existsSync(src) ? src : `${base}/api/video/${clip}`;
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y", "-t", "20", "-i", input,
    "-vf", "hflip,scale=-2:480,pad=640:480:(ow-iw)/2:0:color=0x303030,fps=15,format=yuv420p",
    "-an", camera,
  ]);
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failures.push(msg);
};
const errors = [];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${camera}`,
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const state = () =>
  page.evaluate(() => {
    const s = window.mirrorCoach;
    const e = s?.engine?.state;
    return {
      started: !!s?.started,
      status: e?.status,
      fps: e?.trackingFps,
      score: e?.score,
      limbs: e?.limbScores,
      coach: e?.coachLine,
      refT: s?.reference ? +s.reference.currentTime.toFixed(1) : null,
      refPaused: s?.reference?.paused,
      report: s?.reportStatus?.() ?? "none",
    };
  });
const waitFor = (fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
const buttons = () => page.evaluate(() => window.mirrorCoach.agent.do("buttons"));
/**
 * A real ray select through IWER's emulated right controller: aim from beside
 * the hip at the button's world position, pull the trigger, release. Same
 * InputSystem path a hand-tracking pinch takes. Returns whether the ray hovered it.
 */
const raySelect = (id) =>
  page.evaluate(async (id) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const find = async () => (await window.mirrorCoach.agent.do("buttons")).find((b) => b.id === id);
    const d = window.IWER_DEVICE;
    const c = d?.controllers?.right;
    if (!c) return { error: "no IWER controller" };
    // Otherwise IWER's own desktop UI keeps writing the controller pose.
    d.controlMode = "programmatic";
    const b = await find();
    const from = [0.2, 1.25, -0.1];
    let dx = b.world[0] - from[0], dy = b.world[1] - from[1], dz = b.world[2] - from[2];
    const n = Math.hypot(dx, dy, dz);
    dx /= n; dy /= n; dz /= n;
    // Rotation taking -Z (the target ray) onto the direction to the button.
    const q = [dy, -dx, 0, 1 - dz];
    const qn = Math.hypot(...q);
    c.position.set(...from);
    c.quaternion.set(q[0] / qn, q[1] / qn, q[2] / qn, q[3] / qn);
    await sleep(400);
    const hovered = (await find()).hovered;
    c.updateButtonValue("trigger", 1);
    await sleep(300);
    c.updateButtonValue("trigger", 0);
    await sleep(400);
    return { hovered };
  }, id);

const summary = { base, clip };
try {
  await page.goto(`${base}/xr?v=${clip}&beacon=0`, { waitUntil: "domcontentloaded" });
  await waitFor(() => /ready/i.test(document.getElementById("status")?.textContent ?? ""), null, 90_000);
  await page.click("#allow-camera");
  await waitFor(() => !document.getElementById("enter")?.disabled, null, 60_000);
  await shot("01-setup");
  check(true, "setup: reference and camera ready");

  await page.click("#enter");
  await waitFor(() => window.mirrorCoach?.engine?.state?.status === "Tracking", null, 90_000);
  // The pose model warms up slowly on software GL; wait for real results.
  await waitFor(() => Object.keys(window.mirrorCoach.engine.state.limbScores).length > 0, null, 60_000).catch(() => {});
  await page.waitForTimeout(1500);
  const coaching = await state();
  summary.coaching = coaching;
  await shot("02-coaching");
  check(coaching.fps > 0, `tracking runs (${coaching.fps} fps)`);
  check(Object.keys(coaching.limbs ?? {}).length > 0, `limb scores present (score ${coaching.score})`);

  // Hands-only controls (xr/src/controls.ts).
  const bar = await buttons();
  summary.buttons = bar;
  const shown = bar.filter((b) => b.shown).map((b) => b.id);
  check(shown.length >= 6, `button bar shows ${shown.join(", ")}`);
  const sel = await raySelect("play");
  const afterSel = await state();
  check(sel.hovered && afterSel.refPaused === true, `ray select on Pause pauses the clip (hovered ${sel.hovered}${sel.error ? `, ${sel.error}` : ""})`);
  await page.evaluate(() => window.mirrorCoach.agent.do("press", { button: "play" }));
  const afterPress = await state();
  check(afterPress.refPaused !== afterSel.refPaused, `press play toggles (paused ${afterPress.refPaused})`);
  if (afterPress.refPaused) await page.evaluate(() => window.mirrorCoach.agent.do("play"));
  const calib = await page.evaluate(async () => {
    const a = window.mirrorCoach.agent;
    const before = { ...a.status().calibration };
    await a.do("press", { button: "calibrate" });
    const pad = (await a.do("buttons")).filter((b) => b.shown).map((b) => b.id);
    await a.do("press", { button: "size+" });
    const hfov = a.status().calibration.hfov;
    await a.do("press", { button: "done" });
    const back = (await a.do("buttons")).filter((b) => b.shown).map((b) => b.id);
    await a.do("calibrate", before);
    return { pad, back, grew: Math.abs(hfov - before.hfov - 1) < 1e-6 };
  });
  check(calib.pad.includes("size+") && calib.grew && calib.back.includes("play"), "calibrate mode: size+ nudges hfov, Done returns to the bar");

  if (finishAfter) {
    await page.waitForTimeout(finishAfter * 1000);
    await page.evaluate(() => window.mirrorCoach.finishRun());
  }
  await waitFor(() => window.mirrorCoach?.reportStatus?.() !== "none", null, 120_000);
  const loading = await state();
  await shot("03-report-loading");
  check(loading.refPaused === true, `run end pauses the reference (report ${loading.report})`);

  await waitFor(() => /ready|failed/.test(window.mirrorCoach.reportStatus()), null, 30_000);
  const done = await state();
  summary.report = done.report;
  await page.waitForTimeout(500);
  await shot("04-report");
  // The card's own texture at full resolution, for reviewing typography.
  const card = await page.evaluate(() => window.mirrorCoach.reportCanvas?.toDataURL("image/png"));
  if (card) writeFileSync(join(out, "04-report-card.png"), Buffer.from(card.split(",")[1], "base64"));
  check(/ready/.test(done.report), `report card filled from /api/report (${done.report})`);

  // Agent API (xr/src/agent.ts): actions registered, timeline recorded, calibrate round-trips.
  const agentCheck = await page.evaluate(async () => {
    const a = window.mirrorCoach.agent;
    const actions = Object.keys(a.help());
    const before = { ...a.status().calibration };
    const after = await a.do("calibrate", { distance: before.distance + 0.1 });
    await a.do("calibrate", before);
    return { actions, log: a.log(80), calibrated: Math.abs(after.distance - before.distance - 0.1) < 1e-6 };
  });
  summary.agent = { actions: agentCheck.actions, log: agentCheck.log.slice(-25) };
  check(agentCheck.actions.length >= 15, `agent API exposes ${agentCheck.actions.length} actions`);
  check(agentCheck.log.some((l) => l.includes("run finished")), "agent log records the finished run");
  check(agentCheck.calibrated, "agent calibrate action applies and restores");

  // Go again with a ray select on the card's own button (the hands path).
  const go = await raySelect("goAgain");
  await page.waitForTimeout(1100);
  const again = await state();
  summary.again = again;
  await shot("05-go-again");
  check(go.hovered && again.report === "none" && again.refPaused === false && again.refT < 3, `Go again button on the card hides it and restarts the clip (hovered ${go.hovered})`);

  // Play (not Go again) with the card up must also start the next run, or the
  // skeleton stays hidden behind a stale card for the whole run.
  await page.evaluate(() => window.mirrorCoach.finishRun());
  await waitFor(() => window.mirrorCoach.reportStatus() !== "none", null, 10_000);
  await page.evaluate(() => window.mirrorCoach.agent.do("play"));
  await page.waitForTimeout(800);
  const played = await state();
  check(played.report === "none" && played.refPaused === false, `Play with the card up starts the next run (report ${played.report})`);
} catch (err) {
  failures.push(String(err.message ?? err).split("\n")[0]);
  console.log(`FAIL  ${failures.at(-1)}`);
  await shot("99-failure").catch(() => {});
  summary.lastState = await state().catch(() => null);
} finally {
  summary.errors = errors.slice(0, 20);
  summary.failures = failures;
  writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
  await browser.close();
}
console.log(`\n${failures.length ? `${failures.length} failed` : "all passed"} · screenshots in ${out}`);
if (errors.length) console.log(`${errors.length} console errors (see summary.json)`);
process.exit(failures.length ? 1 : 0);
