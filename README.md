# Mirror Coach

**Learn any move from a video, with a coach that watches you.** Put on a Meta Quest 3, stand in front of a real mirror, and pick a dance or workout video. The headset camera watches your reflection and draws your skeleton over it, with every limb labelled and colored by how closely it matches the reference. A ghost of the reference dancer's pose is fitted onto your body so you can see where each limb should be. The reference video floats beside the mirror (left, top, or right), and a voice coach tells you in real time what to fix ("drop your right shoulder, reach higher with the left arm").

Built at the **Fast Forward Hackathon** (Vercel × Meta, Oct 14 2026) for the **VR Apps** track.

| | URL |
| --- | --- |
| Mixed-reality mirror (Quest) | `https://vercel-ff-five.vercel.app/xr` |
| 2D web app (laptop / phone) | `https://vercel-ff-five.vercel.app/` |
| Repo | https://github.com/aryankeluskar/vercel_ff |

> Hackathon rules, deadlines, rubric and partner tooling: [`AGENTS.md`](./AGENTS.md) (also auto-loaded by Cursor via `.cursor/rules`). The deck is cloned in [`slides/`](./slides).

---

## Status (updated 2:18pm)

| Area | State |
| --- | --- |
| 2D app on Vercel (library, upload, YouTube, live pose, scoring, voice coach, report card) | ✅ deployed |
| All AI through **Vercel AI Gateway** (coach, vision scoring, report, classification, TTS) with fallbacks | ✅ verified locally |
| Reference video library in **Vercel Blob** (shared across laptop, headset and judges) | ✅ 14 curated clips (9 dance, 5 workout), compressed to 540p, pose timelines precomputed, so nothing waits on a download or analysis |
| YouTube download: local yt-dlp → Blob ✅ · **Vercel Sandbox** yt-dlp ⚠️ blocked by YouTube's bot check unless `YTDLP_PROXY` / `YTDLP_COOKIES` is set |
| **`/xr` Mirror Coach** (IWSDK, `immersive-ar`) | ✅ works in the desktop Quest 3 emulator (IWER): tracking, limb labels, ghost pose, HUD, voice coach, end-of-run report card (checked end to end by `scripts/xr-verify.mjs`) |
| On a **real Quest 3** in front of a mirror | ⚠️ headset-only risks fixed in code (see T1), calibration defaults set (T2), **still not tested on a headset**, the #1 TODO |

---

## How it works

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
```

**In the headset (`xr/`):**
1. The setup screen (2D, before entering XR) loads the library, downloads the clip into memory (5–10 MB for curated clips), and fetches its pose timeline. Curated clips ship one computed offline. For anything else, the first device to open it runs MediaPipe over it and saves the timeline for everyone. Then it downloads and compiles the live pose model (MediaPipe, about 12 MB) while you allow the camera, so XR doesn't stall on it.
2. **Camera permission is requested before entering XR.** Quest Browser exposes the passthrough cameras to `getUserMedia` as "camera 1/2, facing back". IWSDK's `CameraUtils` finds them; the stream is opened directly. If the camera stream ends (the headset slept), the setup screen asks for it again.
3. **Enter requests the XR session first, inside the tap**, then starts tracking. The clip starts from 0 once the session is up, loops, and pauses while the headset is off. If the headset refuses the session, or you leave XR, the setup screen comes back and everything stops: tap **Enter** again, no reload. A clip or camera picked there is used on re-entry.
4. In the immersive session, `MirrorSystem` runs every XR frame (window `requestAnimationFrame` doesn't fire in immersive mode). It sends camera frames to MediaPipe Pose (lite) at about 15 Hz, right after each frame is submitted, and re-uploads the video panels from the same loop (the browser's own video-frame callbacks can stop in XR).
5. `CoachEngine` compares your pose to the reference frame at the video's current time in **reflection space**: you follow the video the way you'd follow a dance-studio mirror. Limb names are swapped back to your real body for labels and voice, because a mirror flips left and right.
6. Panels:
   - **Overlay:** head-locked and transparent, sized to the camera's field of view. It shows the skeleton colored per limb, limb score labels, the target posture, and a dashed ghost of the reference pose fitted to your body.
   - **Reference video panel:** grabbable.
   - **HUD:** score, limb bars, coach line, status. Also grabbable.
   - **Report card:** appears in front of you when the clip finishes a full play-through (see 8). Grabbable.
7. The coach goes to `/api/coach` every 3.5–5.5 s, only while the video plays. It gets the per-limb comparison, deltas, milestones and a rotating style, and returns one spoken line plus an mp3. The reference music fades to 25% while the coach speaks.
8. **End of a run:** when the looping clip wraps back to the start, the video pauses, the skeleton hides and a report card appears about 1.15 m in front of you. Grade, average and peak match, and per-limb averages show right away from the run's stats (`app/lib/sessionStats.ts`, shared with the 2D app). The headline, persona and tips arrive from `/api/report` (Llama 4 Maverick via AI Gateway) a few seconds later. **A** starts the next run. Runs where nobody was tracked are skipped.

**Controls in the headset:** **A** play/pause · **B** restart · **X** move the reference (left → top → right) · **Y** show/hide the camera feed (alignment aid) · **right stick** ↕ overlay size, ↔ x offset · **left stick** ↕ y offset · **trigger** on a panel: grab and move it. When the report card is up, **A** (or **B**) starts the next run.
Desktop/emulator keys: `Space`, `R`, `L`, `C`, arrows, `[` `]`, and `G` to end the run now and show the report card (also `mirrorCoach.finishRun()` in the console).

### Model routing (AI Gateway)

All calls go through `app/lib/ai.ts`. Each task has a primary model and Gateway-side fallbacks (`providerOptions.gateway.models`):

| Task | Primary | Fallbacks | Why |
| --- | --- | --- | --- |
| Coach line (every ~4 s) | `meta/llama-4-scout` | `google/gemini-3.5-flash-lite`, `openai/gpt-4o-mini` | Lowest latency (about 1 s), cheap, Meta model |
| Vision pose match (reference frame vs. you) | `meta/llama-4-scout` (multimodal) | same | ~1.2 s per call |
| Voice | `openai/tts-1` | `google/gemini-3.8-flash-lite-tts` | Fast mp3; voice per mode (dance/gym) |
| Report card | `meta/llama-4-maverick` | `google/gemini-3.5-flash`, `openai/gpt-4o-mini` | One-shot, quality over latency |
| Dance vs. fitness | `meta/llama-3.1-8b` | `google/gemini-3.5-flash-lite` | Tiny classification |

Measured locally: coach line plus TTS in 3.4 s end to end (67 KB mp3); vision score in 1.2 s.

### Blob layout

```
videos/<id>.mp4      reference clip (YouTube id or up_<random> for uploads)
videos/<id>.json     { id, title, mode: dance|gym, source, createdAt }
poses/<id>.v1.json   dense pose timeline [{ time, landmarks[33] }]
recordings/<uuid>.webm  session recordings (2D app)
```

---

## Run it

Requirements: Node 24+, pnpm 10, and for YouTube ingest a recent `yt-dlp` (`brew install yt-dlp`, keep it updated, since old versions get HTTP 403).

```bash
vercel link            # team "Aryan Keluskar's projects", project vercel-ff (ask Aryan for access)
vercel env pull .env.local   # BLOB_READ_WRITE_TOKEN + VERCEL_OIDC_TOKEN (AI Gateway + Sandbox auth, expires ~12h, re-pull)
pnpm install
pnpm build:xr          # builds xr/ into public/xr (needed for /xr in next dev)
PORT=3100 pnpm dev     # http://localhost:3100 and http://localhost:3100/xr
```

Iterating on the XR app with hot reload: `cd xr && npm run dev` (IWSDK CLI-managed Vite on https://localhost:8081, proxies `/api` to `localhost:3100`). Read [`xr/AGENTS.md`](./xr/AGENTS.md) first: IWSDK is **not** plain Vite (`iwsdk.config.json` is the authority, import Three from `@iwsdk/core`, no allocation in `update()`).

**Add a reference video:** in the 2D app use **Library → + Upload clip**, or **YouTube URL** (works locally via yt-dlp; it's stored in Blob, so the deployed app and headset see it right away).

### Reference library (`scripts/library/`)

The curated clips are listed in [`scripts/library/clips.json`](./scripts/library/clips.json) (`id` is the YouTube id; optional `start`/`end` trim in seconds). `ingest.mjs` processes each clip, four at a time:

1. Downloads it with yt-dlp.
2. Trims it and re-encodes to 540p at about 1 Mbps, with a keyframe every second and faststart.
3. Runs `poses.py` (MediaPipe PoseLandmarker *heavy*, 0.25 s step, follows one performer).
4. Uploads the mp4, the meta and the timeline to Blob.

```bash
vercel env pull .env.local                                            # BLOB_READ_WRITE_TOKEN
node --env-file=.env.local scripts/library/ingest.mjs                 # all clips (~5 min)
node --env-file=.env.local scripts/library/ingest.mjs <id> [<id>...]  # add or redo some
node scripts/library/ingest.mjs --dry-run <id>                        # check quality, no upload
```

Needs `yt-dlp`, `ffmpeg` and `uv`. `uv` runs `poses.py` with its inline dependencies on Python 3.12. Work files go in `.tools/` (gitignored). Each line prints `detected` (the share of frames with a person) and `fullBody` (the share with nose, wrists and ankles all visible). Keep clips with one performer, facing the camera, a fixed camera and no cuts: aim for `detected` ≥ 0.9.

The order in `clips.json` is the order in the library dropdown. Anything uploaded later appears above it. The `/api/poses` PUT keeps the first timeline saved, so a browser's coarser pass never replaces the offline one.

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
| gym | Squats · 20 reps | Roberta's Gym Love |
| gym | Wide squats · 1 min | WatchFit |
| gym | Shadow boxing · 1 min | ABOVEBOXING |

These are third-party YouTube videos, used as demo references for a hackathon prototype and credited above. They are not ours to redistribute. Before any public launch, replace them with clips we record or license.

**Test on a Quest 3:**
1. Open `https://vercel-ff-five.vercel.app/xr` in Quest Browser.
2. Pick the video, then tap **Allow camera**. Choose a camera labelled *(passthrough)*, set *Camera sees my reflection*, and pick a reference position.
3. Stand about 1.7 m from a mirror (full-length is best). Closer than about 1.5 m, the camera's ~56° vertical view cuts off your reflected feet.
4. Tap **Enter Mirror (MR)**.
5. If the skeleton isn't on your reflection, press **Y** to show the camera feed and use the sticks to align it. Calibration is saved per device. To start again from the defaults in `xr/src/session.ts`, open `/xr?recalibrate=1` once (it discards the saved calibration on every load while the parameter is in the URL).
6. To hand the headset to the next person, leave XR. The setup screen comes back; pick a clip if you like and tap **Enter** again.

**Desktop:** `/xr` on localhost or `*.vercel.app` gets the IWER Quest 3 emulator automatically. Use the laptop webcam with *Camera faces me*. Keep the tab in the foreground: Chrome throttles background tabs to 1 fps, which stalls IWSDK.

### Verify XR without a headset

`scripts/xr-verify.mjs` runs `/xr` end to end in headless Chromium with the IWER Quest 3 emulator. A fake camera plays a dancer clip (mirrored, so it follows the reference), so tracking, scoring, the coach and the report card all run for real:

```bash
PORT=3100 pnpm dev & pnpm build:xr           # serve /xr locally (rebuild after xr/ changes)
node scripts/xr-verify.mjs                   # Rat Dance (15 s): setup → MR → run end → report → Go again
node scripts/xr-verify.mjs --clip <id> --finish-after 12   # longer clips: end the run early
node scripts/xr-verify.mjs --base https://vercel-ff-git-<branch>-aryan-keluskars-projects.vercel.app   # a preview
```

It prints PASS/FAIL per step and writes screenshots to `.tools/xr-verify/`: `01-setup`, `02-coaching`, `03-report-loading`, `04-report`, `05-go-again`, plus `04-report-card.png`, the card's texture at full resolution, for checking typography. The emulator's wide field of view makes panels look smaller than on a Quest. Needs `ffmpeg` and the Playwright Chromium (`cd xr && ./node_modules/.bin/playwright install chromium`).

### Env vars

| Var | Where | Purpose |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Vercel (all envs) | Video library, poses, uploads |
| `VERCEL_OIDC_TOKEN` | auto on Vercel; `vercel env pull` locally | AI Gateway and Sandbox auth (no API key needed) |
| `AI_GATEWAY_API_KEY` | optional | Alternative Gateway auth |
| `YTDLP_PROXY` | optional | Residential proxy URL so the Sandbox can get past YouTube's bot check |
| `YTDLP_COOKIES` | optional | Netscape cookies.txt contents (same purpose; use a throwaway account) |
| `SAM2_ENDPOINT_URL` | optional, local only | Dancer segmentation overlay (Modal, `services/sam2`) |

**Never commit** `.env*`, credit codes, or tokens.

### Deploying (Vercel Git integration, no setup needed)

| You do | Vercel does |
| --- | --- |
| Push any branch other than `master` | Builds a **preview**: `https://vercel-ff-git-<branch>-aryan-keluskars-projects.vercel.app` (stable per branch) plus a unique URL per commit |
| Open a PR | The Vercel bot comments the preview URL on the PR and adds a deploy check |
| Merge or push to `master` | Deploys **production**: https://vercel-ff-five.vercel.app |

- Previews are public (no Vercel login), so they open on the Quest too: test a branch on the headset before merging.
- Every build runs `pnpm build`: the `xr/` typecheck, the `xr/` Vite build, then `next build` (which typechecks the app). A type error fails the deploy instead of shipping.
- Previews and production share the same Blob library and AI Gateway credits.
- No Vercel account is needed to push, but Vercel **blocks** a commit whose author is a teammate's own GitHub account. That includes the squash commit GitHub creates when a teammate's PR is merged, because it takes the PR author. Commits authored by Aryan or by agents (`Claude <noreply@anthropic.com>`) deploy. If production shows "Deployment was blocked", Aryan pushes an empty commit to `master` to redeploy. Build logs live in the Vercel dashboard (ask Aryan for access) or use the "Details" link on the PR check.
- Quick path for small fixes: push straight to `master`. For anything risky (XR changes before the demo), push a branch, check the preview on the headset, then merge.

---

## Team

4 members. Pick whatever TODO you want and put your name on it (edit this file or say so in the group chat).

> **Check other branches before you claim a TODO (everyone, every agent).** Claims and work in progress often sit on a branch that hasn't reached `master` yet. Run `git fetch --all --prune`, then `git branch -r --sort=-committerdate`, then `git log --oneline master..origin/<branch>` for each recent branch, and `gh pr list`. If a branch claims the TODO (a name next to it) or already changes the files it touches, pick another one or coordinate in the group chat. When you claim a TODO, push that one-line README change straight to `master` so everyone sees it.

| # | Name | GitHub |
| --- | --- | --- |
| 1 | Aryan Keluskar | [@aryankeluskar](https://github.com/aryankeluskar) |
| 2 | Ali Sasanian | [@Gond-ul](https://github.com/Gond-ul) |
| 3 | Lucas Masen | [@lucasmasen](https://github.com/lucasmasen) |
| 4 | Cristal | [@cristalj](https://github.com/cristalj) |

## TODO (build stops at 3:00pm, submit by 4:00pm, portal closes 4:10pm)

**P0, must happen for eligibility and the demo**
- [ ] **T1 Real-headset smoke test** (Ali): open `/xr` on a Quest 3 from the production URL. Check that a *facing back* camera shows up, permission works, XR launches, and tracking fps is above 8 (shown on the HUD). Report what breaks.
  - Code side done: Enter now requests the XR session first, inside the click (the browser refuses it a few seconds after a tap, and the old code waited for the pose model). A refused session or leaving XR brings the setup screen back. The pose model (~12 MB) now loads on the setup screen. Video panels refresh from the XR frame loop, since the browser's own video callbacks can stop in XR.
  - On the headset, open `/xr?beacon=1` (the debug beacon is now opt-in). While in XR, read `curl -s https://<host>/api/debug | jq` and check: `visible` is `"visible"` (if `"hidden"`, the camera and video freeze and we need a different approach), `xr` is `"visible"`, `camera.w`×`camera.h` (expect 1280×960), `engine.fps` > 8, and `ref.t` advancing.
- [ ] **T2 Mirror calibration** (Ali): set default `hfov`, `distance` and offsets in `xr/src/session.ts` (`DEFAULT_CALIBRATION`) so the skeleton lands on the reflection without manual tweaking. Note the Quest camera resolution and aspect from the HUD or the console (`mirrorCoach.camera.videoWidth`).
  - Defaults now: distance 3.4 m (reflection depth for a user 1.7 m from the mirror), hfov 71°, offsetY −0.03 m, offsetX 0. Sources and reasoning are in the comment above `DEFAULT_CALIBRATION`. Not measured on a headset.
  - On the headset: stand 1.7 m from the mirror, press **Y** to show the feed, align with the sticks, then copy `calibration` from `/api/debug` into `DEFAULT_CALIBRATION`. To learn which lens "camera 1" is, cover the left front camera with a finger: if the feed goes dark it's the left one and offsetX should be about −0.035, otherwise about +0.035. Open `/xr?recalibrate=1` to drop a saved calibration.
- [x] **T3 Demo reference clips**: 14 clips (9 dance, 5 workout) are in the library with pose timelines precomputed. See [Reference library](#reference-library-scriptslibrary).
- [ ] **T4 Audio check in headset** (Ali): reference music and coach voice are both audible. If they clash, duck the music while the coach speaks (`app/shared/speech.ts`).
  - Code side done: the music fades to 25% while the coach talks. The coach voice now reuses one audio element that is unlocked by the Enter tap, so the browser can't block lines spoken later in XR. Still needs an ears-on check in the headset.

**P1, makes the demo land**
- [ ] **T5 Spatial UI**: replace the canvas HUD with an IWSDK UIKit panel (`iwsdk-ui` skill) with play/pause, restart and layout buttons for hand-tracking users (no controllers).
- [ ] **T6 Hand tracking input**: pinch to play/pause, and `GrabSystem.useHandPinchForGrab` for moving panels.
- [ ] **T7 Vision anchor in XR**: blend `/api/score` (Llama 4 Scout vision) into the XR score every 3 s, as the 2D app does (`app/lib/groqScoring.ts`). Capture from `session.camera` and the reference video.
- [x] **T8 Session summary in XR** (Aryan): the report card appears after each full play-through (see How it works, step 8). Verified end to end in the emulator with `scripts/xr-verify.mjs`.

**P2, nice to have**
- [ ] **T9 Backup demo video**: screen-record the IWER emulator run and the real headset cast. Upload it and add it to the submission links.
- [ ] **T10 Submission copy**: draft below. Confirm the production URL works signed-out and on another device.
- [ ] YouTube in production: set `YTDLP_PROXY` (residential) so `/api/download` works from Vercel without the laptop.
- [ ] Generation mode: rebuild "describe a move → AI video" on AI Gateway video models (`experimental_generateVideo`, e.g. `google/veo-3.1-fast-generate-001`) to replace the old Perplexity/HeyGen/xAI path in `app/api/generate`.

## Demo plan

Based on our TreeHacks video ([youtube.com/watch?v=kL3udtWY1EE](https://www.youtube.com/watch?v=kL3udtWY1EE), 2:18). What worked there: a skit-based problem setup in the first 20 s, a **real coach line heard out loud**, an on-camera "it told me my arms are off" moment, and a funny ending (the "F" report card). What we change: that video spent 50 s on breadth (Zoom and generate modes). VR judges score *fun*, *creativity and use of VR*, and *execution*, so we spend that time on the mirror, presence and the spatial layout.

### Two deliverables, one shoot

**A. Recorded video, 75–90 s** (link it in the submission; Round 1 judges see only the submission)

| Time | Shot | Source |
| --- | --- | --- |
| 0:00–0:08 | **Skit:** teammate at a mirror, phone propped up playing a dance tutorial, flailing: *"I've watched this twenty times. What are my arms even doing?"* | Phone |
| 0:08–0:12 | Puts on the Quest. Title: **Mirror Coach: your mirror finally talks back.** | Phone |
| 0:12–0:40 | **Hero:** headset POV. The reflection with the colored skeleton, limb labels and dashed ghost; the reference on the left; score climbing. Press **X**: the reference flies to the top. | Quest recording or cast |
| 0:40–0:55 | **The fix-it moment:** the coach says something specific (e.g. "right arm higher") → the dancer fixes it → that limb turns green → the score jumps. React like the TreeHacks video did. | Quest POV, then a phone over-the-shoulder shot of the real setup |
| 0:55–1:10 | **How it's built**, as fast on-screen text over B-roll: Meta IWSDK `immersive-ar` + Quest passthrough camera → MediaPipe in the browser → Llama 4 Scout via Vercel AI Gateway → voice. Runs from a URL, no install. | Edit |
| 1:10–1:20 | **Close:** "Any video. Any mirror." + URL. Optional laugh: the dancer gets roasted by the coach. | Phone |

**B. Live finalist demo, 3:00, no Q&A** (if we make the top 3 at 4:50)
- **0:00–0:20 Problem**, one sentence plus the skit line: "The internet has infinite demonstrations and zero correction. A mirror shows you, but it can't tell you what's wrong."
- **0:20–2:10 Live:** a teammate in the Quest facing the mirror, casting to the screen. Narrate three things: limb labels on the reflection, the ghost pose, a voice correction followed by the fix. Press X to move the reference.
- **2:10–2:45 Why VR + how:** your actual body in your actual room, hands free, anchored panels; the IWSDK + Quest passthrough camera + AI Gateway stack.
- **2:45–3:00 Close:** dance today; physio, yoga and martial arts next.
- **If anything fails live:** play video A immediately. Have it open in a tab before our slot.

### Logistics (decide in the next 15 minutes)
- **Mirror:** ✅ there is a big mirror next to our table. Shoot and demo there; full-body routines are fine.
- **Reference clip:** a teammate films a 30–45 s front-facing routine on a phone (no rights issues, and it matches our skit). Upload it in the 2D app, then open it once on the laptop to cache the poses.
- **Recording:** with the headset in developer mode (our Meta dev org), Meta Quest Developer Hub can cast and record the headset view on a laptop. Otherwise try the Quest's built-in recorder on an MR session first; if passthrough comes out black, film the cast window plus a phone shot of the person.
- **Audio:** make sure the coach voice is audible in the recording and through the AV cast. Ask the AV team at 4:50 whether casting carries Quest audio; otherwise hold a mic near the headset speaker.
- **Judges without a mirror:** Round 1 judges try it on a Quest themselves. Put "needs a mirror, stand 1.7 m away" at the top of the setup instructions, plus the video link as the fallback.

### Timeline (now → 4:00)
| Time | What |
| --- | --- |
| 1:20–1:50 | Headset smoke test + calibration (T1, T2) · film the reference clip (T3) |
| 1:50–2:30 | Fix whatever the headset test finds |
| 2:30–3:10 | Shoot video A (skit, POV, fix-it moment, B-roll) |
| 3:10–3:40 | Edit (CapCut), upload to YouTube unlisted, fill in the submission |
| 3:40–4:00 | Submit, check the showcase links signed-out, rehearse B once |

## Submission draft (VR Apps track)

**Name:** Mirror Coach
**Description:** Mirror Coach turns any dance or workout video into a live, immersive lesson on Meta Quest 3. Stand in front of a real mirror in mixed reality. The headset's passthrough camera tracks your reflection with MediaPipe Pose and overlays your skeleton with every limb labelled and colored by how well it matches the reference. A ghost of the instructor's pose is fitted onto your body, and the reference video floats beside the mirror. A voice coach (Meta Llama 4 Scout through Vercel AI Gateway, with TTS) gives one specific correction every few seconds. Built with Meta's Immersive Web SDK (immersive-ar, passthrough camera, grabbable panels), Next.js on Vercel, Vercel Blob, Vercel Sandbox and AI Gateway with model fallbacks. Runs in Quest Browser from a live HTTPS URL. There's also a 2D web version for laptops.
**Demo setup:** Needs a mirror (full-length is best). Open `/xr` on a Quest 3, allow camera access, pick the "(passthrough)" camera, stand facing the mirror about 1.7 m away, then Enter Mirror (MR). No login. Demo video: <link>. Without a mirror, choose "Camera faces me" in the 2D view; on desktop the Quest emulator loads automatically.

## Conventions for humans and agents

- **Check other branches before claiming or starting a TODO** (see [Team](#team)): `git fetch --all --prune && git branch -r --sort=-committerdate`, then `git log --oneline master..origin/<branch>`. Never claim work that another branch already claims or touches.
- **Pull before you push; commit small and often.** `master` auto-deploys to production; every other branch gets a public preview (see Deploying). Re-open the URL after each deploy.
- Run `pnpm build` before pushing; it builds `xr/` too, exactly like Vercel does.
- **XR changes: run `node scripts/xr-verify.mjs` and look at the screenshots before pushing** (see [Verify XR without a headset](#verify-xr-without-a-headset)). A typecheck doesn't prove the panels render or the flow works.
- Shared logic lives in `app/lib` and `app/shared` and is used by both the 2D app and `xr/`. Don't fork it.
- Debug the headset from the console: `mirrorCoach.engine.state` (score, limbs, fps, coach line) and `mirrorCoach.calibration`.
- **Remote headset debugging (no adb needed):** open `/xr?beacon=1` and it posts its state every 5 s. Read it with `curl -s https://vercel-ff-five.vercel.app/api/debug | jq` (camera list and resolution, tracking fps, score, limbs, coach line, calibration, last errors). It's opt-in because every post is a Vercel Blob write, and the video library lives in the same Blob store.
- IWSDK skills for agents: `xr/.claude/skills` (Claude Code), `xr/.agents` (Codex), `xr/.cursor` (Cursor), plus the Meta-provided `.claude/skills/iwsdk-dev`.

## Known gotchas

- **Quest camera permission** must be granted in 2D *before* entering XR. Requesting it inside the session ends the session.
- **Request the XR session synchronously inside the Enter click** (`world.launchXR()` before any `await`). The browser only grants an immersive session during a fresh user gesture, so waiting on the pose model or a fetch first can get it refused on a real Quest. Unlock audio in the same click: `unlockSpeech()` (coach voice) and a play/pause of the reference.
- **YouTube blocks datacenter IPs**, including Vercel Sandbox ("Sign in to confirm you're not a bot"). Ingest from a laptop, or set a proxy.
- **The emulator spoofs the Quest user agent** (`OculusBrowser/33`), so don't detect the headset by user agent.
- **MediaPipe Pose (legacy) misbehaves with several instances per page.** In XR the live model preloads only after the first clip's timeline is ready, and a later in-browser analysis waits for it. Switching to a clip without a saved timeline after that still runs a second instance, so use clips whose timelines are saved (all curated clips are).
- **Hidden tabs** throttle requestAnimationFrame to 1 Hz. `World.create` and tracking stall until the tab is visible.
