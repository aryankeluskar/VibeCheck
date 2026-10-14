#!/usr/bin/env node
/**
 * Builds the shared reference library in Vercel Blob from clips.json, so no
 * device ever waits on a YouTube download or an in-browser pose pass.
 *
 * Per clip: yt-dlp → ffmpeg (trim, 540p, ~1 Mbps, faststart) → offline
 * MediaPipe timeline (poses.py, heavy model, 0.25 s step) → Blob:
 *   videos/<id>.mp4, videos/<id>.json, poses/<id>.v1.json
 *
 *   node --env-file=.env.local scripts/library/ingest.mjs            # all clips
 *   node --env-file=.env.local scripts/library/ingest.mjs <id> ...   # some clips
 *   node scripts/library/ingest.mjs --dry-run                        # no upload
 *
 * Needs yt-dlp, ffmpeg and uv on PATH (POSE_PYTHON=<python> skips uv).
 * Work files go to .tools/ (gitignored).
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { put } from "@vercel/blob";

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tools = join(root, ".tools");
const rawDir = join(tools, "raw");
const outDir = join(tools, "out");
const model = join(tools, "models/pose_landmarker_heavy.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task";
const CONCURRENCY = 4;
// Library order is createdAt descending; curated clips sit just below this,
// in clips.json order, so anything uploaded later shows first.
const BASE_TIME = Date.parse("2026-10-14T20:00:00Z");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.filter((a) => !a.startsWith("--"));
const clips = JSON.parse(readFileSync(join(root, "scripts/library/clips.json"), "utf8"));
const selected = only.length ? clips.filter((c) => only.includes(c.id)) : clips;

if (!dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("BLOB_READ_WRITE_TOKEN missing: run with --env-file=.env.local (vercel env pull)");
  process.exit(1);
}
for (const d of [rawDir, outDir, dirname(model)]) mkdirSync(d, { recursive: true });

const run = (cmd, argv) => exec(cmd, argv, { cwd: root, maxBuffer: 64 * 1024 * 1024 });

if (!existsSync(model)) {
  console.log("Downloading pose_landmarker_heavy.task…");
  await run("curl", ["-sfL", "-o", model, MODEL_URL]);
}

const [py, pyArgs] = process.env.POSE_PYTHON
  ? [process.env.POSE_PYTHON, []]
  : ["uv", ["run", "-q", "--python", "3.12", "--script"]];

async function ingest(clip) {
  const t0 = Date.now();
  const raw = join(rawDir, `${clip.id}.mp4`);
  const mp4 = join(outDir, `${clip.id}.mp4`);
  const poses = join(outDir, `${clip.id}.v1.json`);

  if (!existsSync(raw)) {
    await run("yt-dlp", [
      "-q", "--no-warnings",
      // res = shortest side, so portrait Shorts come down at 720x1280
      "-S", "res:720,ext:mp4:m4a",
      "--merge-output-format", "mp4",
      "-o", join(rawDir, "%(id)s.%(ext)s"),
      "--", clip.id,
    ]);
  }

  await run("ffmpeg", [
    "-loglevel", "error", "-y",
    ...(clip.start ? ["-ss", String(clip.start)] : []),
    ...(clip.end ? ["-to", String(clip.end)] : []),
    "-i", raw,
    // Short side at most 540 px (portrait Shorts stay 540x960).
    "-vf", "scale='if(gt(ih,iw),min(540,iw),-2)':'if(gt(ih,iw),-2,min(540,ih))'",
    "-c:v", "libx264", "-preset", "slow", "-crf", "26",
    "-maxrate", "1200k", "-bufsize", "2400k",
    // A keyframe every second keeps seeks cheap if a browser re-analyzes it.
    "-force_key_frames", "expr:gte(t,n_forced*1)",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-ac", "2",
    "-movflags", "+faststart", mp4,
  ]);

  const { stderr } = await run(py, [...pyArgs, "scripts/library/poses.py", mp4, poses, "--model", model]);
  const stats = JSON.parse(stderr.trim().split("\n").filter((l) => l.startsWith("{")).pop() ?? "{}");

  if (!dryRun) {
    const opts = { access: "public", addRandomSuffix: false, allowOverwrite: true };
    const json = { ...opts, contentType: "application/json", cacheControlMaxAge: 60 };
    await put(`videos/${clip.id}.mp4`, readFileSync(mp4), { ...opts, contentType: "video/mp4", multipart: true });
    await put(`poses/${clip.id}.v1.json`, readFileSync(poses), json);
    const meta = {
      id: clip.id,
      title: clip.title,
      mode: clip.mode,
      source: "youtube",
      createdAt: new Date(BASE_TIME - clips.indexOf(clip) * 1000).toISOString(),
    };
    await put(`videos/${clip.id}.json`, JSON.stringify(meta), json);
  }

  const mb = (readFileSync(mp4).length / 1e6).toFixed(1);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(
    `${clip.id.padEnd(12)} ${mb.padStart(4)} MB  ${String(stats.duration).padStart(5)} s  ` +
      `detected ${stats.detected}  fullBody ${stats.fullBody}  ${secs}s${dryRun ? "  (dry run)" : "  uploaded"}  ${clip.title}`,
  );
}

const queue = [...selected];
let failed = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let clip; (clip = queue.shift()); ) {
      try {
        await ingest(clip);
      } catch (err) {
        failed++;
        console.error(`${clip.id} FAILED: ${(err.stderr || err.message || err).toString().trim().slice(-400)}`);
      }
    }
  }),
);
process.exit(failed ? 1 : 0);
