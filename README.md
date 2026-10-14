# VibeCheck 🪞

Demo video: https://youtu.be/oF5_4Gov9E8

**Real-time mixed-reality dance and fitness coaching, on your own reflection.**

<img width="1400" alt="VibeCheck on a Quest 3: the Rat Dance reference video above a real mirror, the live HUD with match score and limb bars, pinch buttons, and the end-of-run report card" src="docs/mirror-coach.jpg" />

Built at the Fast Forward Hackathon (Vercel × Meta, Oct 14 2026) for the VR Apps track.

| | |
| --- | --- |
| Mixed-reality mirror (Meta Quest 3) | https://vercel-ff-five.vercel.app/xr |
| 2D version (laptop or phone webcam) | https://vercel-ff-five.vercel.app/ |
| Demo video | https://youtu.be/oF5_4Gov9E8 |

## What it does

After the pandemic and the explosion of TikTok dances, a lot of people learn moves from online videos. A video shows you the move and a mirror shows you yourself, but neither tells you what you're doing wrong.

With VibeCheck, you put on a Meta Quest 3, stand in front of a real mirror, and pick a dance or workout video. The headset's passthrough camera watches your reflection and draws your skeleton on top of it, every limb colored and labelled by how closely it matches the reference, with a ghost of the instructor's pose fitted to your body. The reference video floats beside the mirror, a voice coach tells you what to fix while you move ("drop your right shoulder, reach higher with the left arm"), and when the clip ends you get a report card.

### Core features

- **Skeleton on your reflection:** per-limb colors and score labels, the target posture, and a dashed ghost of the reference pose fitted to your body, drawn where the mirror shows you.
- **Registration from the headset's own calibration:** the overlay uses the Quest camera's factory intrinsics and extrinsics (a 72.7° × 57.8° crop, an 11° downward tilt, the lens offset from the eyes). It is anchored to the head pose each camera frame was captured at, and the distance to your reflection is measured continuously from your torso size.
- **Live voice coach:** every few seconds Llama 4 Scout (through Vercel AI Gateway) turns the per-limb comparison into one spoken correction; the music ducks while it talks.
- **Report card:** after each full play-through, a letter grade, average and peak match, per-limb breakdown, and a headline, persona and tips from Llama 4 Maverick.
- **Hands only, no controllers:** pinch buttons for play, restart, layout, camera feed, calibration and end run; pinch **Go again** on the report card; or raise both hands to resume.
- **Reference library:** 15 curated clips (9 dance, 6 workout) in Vercel Blob with pose timelines computed offline, so nothing waits on analysis. The 2D app adds uploads and YouTube links.
- **Spatial layout:** the reference video goes left, above or right of the mirror; every panel can be grabbed and moved.
- **Agent-native:** `window.mirrorCoach.agent` (help, status, log, do) drives the app; `scripts/quest-drive.mjs` drives a real Quest over USB; `scripts/xr-verify.mjs` runs the whole flow headless in Meta's IWER emulator.

## Quick Start

### Try it on a Quest 3 (nothing to install)

1. Meta Quest 3 with Quest Browser, and a mirror (full-length is best). No login.
2. Stand 1.5–2 m from the mirror, facing it.
3. Open https://vercel-ff-five.vercel.app/xr, pick a clip, tap **Allow camera** and accept the prompt, then tap **Enter Mirror (MR)**.
4. Dance along. Point and pinch the buttons under the HUD; when the report card appears, pinch **Go again** for the next run.
5. To hand the headset over or pick another clip, leave XR: the setup screen comes back.

### Run it locally

Prerequisites: Node 24+, pnpm 10, and for YouTube ingest a recent `yt-dlp` and `ffmpeg`.

```bash
vercel link                  # project vercel-ff (ask Aryan for access)
vercel env pull .env.local   # BLOB_READ_WRITE_TOKEN + VERCEL_OIDC_TOKEN (AI Gateway auth, re-pull after ~12 h)
pnpm install
pnpm build:xr                # builds xr/ into public/xr
PORT=3100 pnpm dev           # http://localhost:3100 (2D) and http://localhost:3100/xr (MR)
```

On localhost, `/xr` gets the IWER Quest 3 emulator automatically: use the laptop webcam with *Camera faces me*. Hot reload for the XR app: `cd xr && npm run dev` (IWSDK's CLI-managed Vite on https://localhost:8081, proxying `/api` to `localhost:3100`). Read [`xr/AGENTS.md`](./xr/AGENTS.md) first: IWSDK is not plain Vite.

| Env var | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Video library, pose timelines, uploads |
| `VERCEL_OIDC_TOKEN` | AI Gateway and Sandbox auth (automatic on Vercel; `vercel env pull` locally) |
| `AI_GATEWAY_API_KEY` | Optional alternative Gateway auth |
| `YTDLP_PROXY` / `YTDLP_COOKIES` | Optional, lets Vercel Sandbox past YouTube's bot check |
| `SAM2_ENDPOINT_URL` | Optional, local only: dancer segmentation in the 2D app (`services/sam2`) |

Never commit `.env*`, credit codes or tokens.

## How Scoring Works

Every tracked frame (about 15 per second in the headset), your pose is compared with the reference frame at the video's current time:

| Signal | Weight | Source |
| --- | --- | --- |
| Per-limb pose match | 80% | Joint angles and positions of each limb against the closest reference frame, in reflection space (you follow the video like a dance-studio mirror) |
| Body heuristics | 20% | Arm height, symmetry, motion energy, torso lean |

The score is EMA-smoothed (alpha 0.15). Limb names are swapped back to your real body for labels and the voice, because a mirror flips left and right. The 2D app also blends in a vision score: Llama 4 Scout compares a reference frame with a webcam frame every few seconds.

### Report card grades

| Grade | Average match |
| --- | --- |
| S | 78+ |
| A | 62+ |
| B | 45+ |
| C | 30+ |
| D | below 30 |

The grade, averages and limb bars come from the run's own data and appear immediately. The headline, persona and tips arrive from `/api/report` a few seconds later.

## Architecture

```
                 ┌────────────────── Next.js on Vercel ───────────────────┐
 Laptop (2D) ──▶ │ /            2D coach (webcam + reference side by side) │
 Quest (MR)  ──▶ │ /xr          IWSDK mirror app (built from xr/)          │
                 │ /api/library   list videos        (Vercel Blob)         │
                 │ /api/download  YouTube → Blob     (local yt-dlp │ Sandbox)│
                 │ /api/upload    browser → Blob token (clips, recordings) │
                 │ /api/video/:id 307 → Blob mp4 (CORS ok, byte ranges)    │
                 │ /api/poses/:id dense reference pose timeline (Blob)     │
                 │ /api/coach     coach line + TTS mp3 ─┐                  │
                 │ /api/score     vision pose match    ─┼─▶ AI Gateway     │
                 │ /api/report    end-of-session card  ─┘                  │
                 └─────────────────────────────────────────────────────────┘

Quest passthrough camera (getUserMedia) → MediaPipe Pose in the browser (~15 Hz)
  → CoachEngine: per-limb match vs. the reference timeline → score, labels, ghost pose
  → overlay plane at the reflection's depth, anchored to the head pose at capture
  → /api/coach every 3.5–5.5 s → spoken line (music ducks to 25%)
  → clip wraps → report card → /api/report
```

In the headset, the setup screen (2D, before XR) loads the clip, its pose timeline and the live pose model, and asks for the camera, because Quest Browser only grants camera permission outside an immersive session. **Enter** requests the XR session inside the tap. In the session, `MirrorSystem` (`xr/src/mirror-system.ts`) runs every XR frame: it sends camera frames to MediaPipe, re-uploads the video panels, and places the overlay.

### Model routing (AI Gateway)

All model calls go through `app/lib/ai.ts`, each with Gateway-side fallbacks:

| Task | Primary | Fallbacks |
| --- | --- | --- |
| Coach line (every ~4 s) | `meta/llama-4-scout` | `google/gemini-3.5-flash-lite`, `openai/gpt-4o-mini` |
| Vision pose match (2D app) | `meta/llama-4-scout` | same |
| Voice | `openai/tts-1` | `google/gemini-3.8-flash-lite-tts` |
| Report card | `meta/llama-4-maverick` | `google/gemini-3.5-flash`, `openai/gpt-4o-mini` |
| Dance vs. fitness | `meta/llama-3.1-8b` | `google/gemini-3.5-flash-lite` |

## Tech Stack

- **Mixed reality:** Meta Immersive Web SDK (IWSDK), WebXR `immersive-ar` with passthrough and hand tracking, Three.js
- **Camera:** the Quest passthrough camera through `getUserMedia`
- **Pose detection:** MediaPipe Pose in the browser (live), MediaPipe PoseLandmarker heavy offline for the library
- **AI:** AI SDK through Vercel AI Gateway (Llama 4 Scout and Maverick, OpenAI TTS, with fallbacks)
- **App and hosting:** Next.js (App Router), React, TypeScript, Tailwind CSS, Vercel
- **Storage:** Vercel Blob (videos, pose timelines, recordings)
- **Video ingest:** yt-dlp + ffmpeg, locally or in Vercel Sandbox

## Development

### Reference library

The curated clips are listed in [`scripts/library/clips.json`](./scripts/library/clips.json) (`id` is the YouTube id; optional `start`/`end` trim in seconds). `scripts/library/ingest.mjs` downloads each clip, re-encodes it to 540p, runs `poses.py` (MediaPipe PoseLandmarker heavy, 0.25 s step) and uploads the mp4, its metadata and the timeline to Blob:

```bash
node --env-file=.env.local scripts/library/ingest.mjs                 # all clips (~5 min)
node --env-file=.env.local scripts/library/ingest.mjs <id> [<id>...]  # add or redo some
node scripts/library/ingest.mjs --dry-run <id>                        # check quality, no upload
```

Needs `yt-dlp`, `ffmpeg` and `uv`. Keep clips with one performer, facing the camera, a fixed camera and no cuts (`detected` ≥ 0.9). In the 2D app, **Library → + Upload clip** or a YouTube URL adds a clip for everyone.

| Mode | Clip | Credit (YouTube) |
| --- | --- | --- |
| dance | Rat Dance · tutorial | Bizzy Boom |
| dance | Macarena · step by step | wikiHow |
| dance | Greedy (Tate McRae) · beginner choreo | Tiana Shern |
| dance | The Griddy · tutorial | 1NINEFIVE |
| dance | The Floss · step by step | wikiHow |
| dance | Zumba warm-ups: Let's Go, Aguita, Marimba | Z-Therapy Holly Corrente |
| dance | Sharara · easy choreo | Boomoves |
| gym | High knees · 1 min | Olena |
| gym | Jumping jacks · 1 min | GVSU Human Resources |
| gym | Bicep curls · 1 min | GVSU Human Resources |
| gym | Squats · 20 reps | Roberta's Gym Love |
| gym | Wide squats · 1 min | WatchFit |
| gym | Shadow boxing · 1 min | ABOVEBOXING |

These are third-party YouTube videos, used as demo references for a hackathon prototype and credited above. They are not ours to redistribute; replace them with recorded or licensed clips before any public launch.

### Drive a real Quest from the laptop

With developer mode on and the headset plugged in over USB, `scripts/quest-drive.mjs` talks to Quest Browser over ADB and DevTools:

```bash
node scripts/quest-drive.mjs open "https://vercel-ff-five.vercel.app/xr?beacon=1&v=FILJpZiAFo0"   # open on the headset
TARGET=21 node scripts/quest-drive.mjs state      # mirrorCoach.agent.status(): fps, scores, coach line, calibration
node scripts/quest-drive.mjs do selectClip '{"id":"FILJpZiAFo0"}'   # any agent action: enter, play, finishRun, calibrate…
node scripts/quest-drive.mjs view                 # what the wearer sees (passthrough + XR)
node scripts/quest-drive.mjs cast                 # wireless cast over Wi-Fi ADB (needs a network that allows it)
```

It uses Meta Quest Developer Hub's `adb` when installed. Only one browser tab can hold the passthrough camera at a time.

### Verify XR without a headset

```bash
PORT=3100 pnpm dev & pnpm build:xr
node scripts/xr-verify.mjs                    # setup → MR → coaching → run end → report card → Go again
node scripts/xr-verify.mjs --base https://vercel-ff-git-<branch>-aryan-keluskars-projects.vercel.app
```

It runs `/xr` in headless Chromium with the IWER emulator and a fake camera playing a dancer, prints PASS/FAIL per step and saves screenshots to `.tools/xr-verify/`. It must pass before any XR change is pushed.

### Deploying

Pushing to `master` deploys production (https://vercel-ff-five.vercel.app); every other branch gets a public preview at `https://vercel-ff-git-<branch>-aryan-keluskars-projects.vercel.app` that also opens on the Quest. Every build runs `pnpm build` (the `xr/` typecheck and build, then `next build`). Vercel blocks commits authored by GitHub accounts outside the Vercel team; if production shows "Deployment was blocked", Aryan pushes an empty commit to redeploy.

### Contributing (humans and agents)

- **Check other branches before you claim or start a TODO:** `git fetch --all --prune`, `git branch -r --sort=-committerdate`, `git log --oneline master..origin/<branch>`, and `gh pr list`. If a branch already claims it or touches its files, pick something else. Push a claim straight to `master` so everyone sees it.
- Pull before you push; run `pnpm build` first. XR changes also need `node scripts/xr-verify.mjs`.
- Agents drive `/xr` through `mirrorCoach.agent` (see [`AGENTS.md`](./AGENTS.md#working-on-the-xr-app-as-an-agent-xr)); new XR behavior gets a registered action and a verifier check.
- Shared logic lives in `app/lib` and `app/shared`, used by both the 2D app and `xr/`.

### Known gotchas

- **Quest camera permission** must be granted in 2D before entering XR; requesting it inside the session ends the session.
- **Request the XR session synchronously inside the Enter tap**, before any `await`, or the browser refuses it.
- **YouTube blocks datacenter IPs**, including Vercel Sandbox. Ingest from a laptop, or set a proxy.
- **The emulator spoofs the Quest user agent**, so don't detect the headset by user agent.
- **Hidden tabs and a headset nobody is wearing** stop `requestAnimationFrame`, so setup and tracking pause until the page is visible.

Hackathon working notes (status, TODO list, demo plan, submission copy) are in [`docs/hackathon.md`](./docs/hackathon.md).

## Team

| Name | GitHub |
| --- | --- |
| Aryan Keluskar | [@aryankeluskar](https://github.com/aryankeluskar) |
| Ali Sasanian | [@Gond-ul](https://github.com/Gond-ul) |
| Lucas Masen | [@lucasmasen](https://github.com/lucasmasen) |
| Cristal Jiang | [@cristalj](https://github.com/cristalj) |
