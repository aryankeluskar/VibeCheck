#!/usr/bin/env node
/**
 * End-to-end visual check of /xr without a headset: headless Chromium, the
 * IWER Quest 3 emulator (auto-injected on localhost), and a fake camera that
 * plays a dancer clip, so tracking, scoring and the coach run for real.
 *
 * Flow: setup screen → allow camera → Enter Mirror (MR) → coaching → the clip
 * finishes a play-through → report card → A/Space "Go again".
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

  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  const again = await state();
  summary.again = again;
  await shot("05-go-again");
  check(again.report === "none" && again.refPaused === false && again.refT < 3, "Go again hides the card and restarts the clip");
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
