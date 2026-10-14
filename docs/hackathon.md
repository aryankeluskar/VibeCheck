# Hackathon notes

Working notes from the Fast Forward Hackathon build (Oct 14 2026): status, TODO list, demo plan and the submission copy. The project README is [`../README.md`](../README.md); rules, deadlines and the rubric are in [`../AGENTS.md`](../AGENTS.md).

## Status (updated 2:18pm)

| Area | State |
| --- | --- |
| 2D app on Vercel (library, upload, YouTube, live pose, scoring, voice coach, report card) | ✅ deployed |
| All AI through **Vercel AI Gateway** (coach, vision scoring, report, classification, TTS) with fallbacks | ✅ verified locally |
| Reference video library in **Vercel Blob** (shared across laptop, headset and judges) | ✅ 15 curated clips (9 dance, 6 workout), compressed to 540p, pose timelines precomputed, so nothing waits on a download or analysis |
| YouTube download: local yt-dlp → Blob ✅ · **Vercel Sandbox** yt-dlp ⚠️ blocked by YouTube's bot check unless `YTDLP_PROXY` / `YTDLP_COOKIES` is set |
| **`/xr` Mirror Coach** (IWSDK, `immersive-ar`) | ✅ works in the desktop Quest 3 emulator (IWER): tracking, limb labels, ghost pose, HUD, voice coach, end-of-run report card (checked end to end by `scripts/xr-verify.mjs`) |
| On a **real Quest 3** in front of a mirror | ✅ **works (2:30pm, Quest Browser 152)**: passthrough camera 1280×960 (`camera 1/2, facing back`), XR session, tracking at 15 fps, limb scores, target posture, live voice coach. Read over USB with `scripts/quest-drive.mjs`. Calibration still to confirm by eye (T2) |

## TODO (build stops at 3:00pm, submit by 4:00pm, portal closes 4:10pm)

**P0, must happen for eligibility and the demo**
- [ ] **T1 Real-headset smoke test** (Ali): open `/xr` on a Quest 3 from the production URL. Check that a *facing back* camera shows up, permission works, XR launches, and tracking fps is above 8 (shown on the HUD). Report what breaks.
  - Code side done: Enter now requests the XR session first, inside the click (the browser refuses it a few seconds after a tap, and the old code waited for the pose model). A refused session or leaving XR brings the setup screen back. The pose model (~12 MB) now loads on the setup screen. Video panels refresh from the XR frame loop, since the browser's own video callbacks can stop in XR.
  - On the headset, open `/xr?beacon=1` (the debug beacon is now opt-in). While in XR, read `curl -s https://<host>/api/debug | jq` and check: `visible` is `"visible"` (if `"hidden"`, the camera and video freeze and we need a different approach), `xr` is `"visible"`, `camera.w`×`camera.h` (expect 1280×960), `engine.fps` > 8, and `ref.t` advancing.
- [ ] **T2 Mirror calibration** (Ali): set default `hfov`, `distance` and offsets in `xr/src/session.ts` (`DEFAULT_CALIBRATION`) so the skeleton lands on the reflection without manual tweaking. Note the Quest camera resolution and aspect from the HUD or the console (`mirrorCoach.camera.videoWidth`).
  - Defaults now: distance 3.4 m (reflection depth for a user 1.7 m from the mirror), hfov 71°, offsetY −0.03 m, offsetX 0. Sources and reasoning are in the comment above `DEFAULT_CALIBRATION`. Not measured on a headset.
  - On the headset: stand 1.7 m from the mirror, press **Y** to show the feed, align with the sticks, then copy `calibration` from `/api/debug` into `DEFAULT_CALIBRATION`. To learn which lens "camera 1" is, cover the left front camera with a finger: if the feed goes dark it's the left one and offsetX should be about −0.035, otherwise about +0.035. Open `/xr?recalibrate=1` to drop a saved calibration.
- [x] **T3 Demo reference clips**: 15 clips (9 dance, 6 workout) are in the library with pose timelines precomputed. See [Reference library](../README.md#reference-library).
- [ ] **T4 Audio check in headset** (Ali): reference music and coach voice are both audible. If they clash, duck the music while the coach speaks (`app/shared/speech.ts`).
  - Code side done: the music fades to 25% while the coach talks. The coach voice now reuses one audio element that is unlocked by the Enter tap, so the browser can't block lines spoken later in XR. Still needs an ears-on check in the headset.

**P1, makes the demo land**
- [ ] **T5 Spatial UI**: replace the canvas HUD with an IWSDK UIKit panel (`iwsdk-ui` skill) with play/pause, restart and layout buttons for hand-tracking users (no controllers).
- [ ] **T6 Hand tracking input**: pinch to play/pause, and `GrabSystem.useHandPinchForGrab` for moving panels.
- [ ] **T7 Vision anchor in XR**: blend `/api/score` (Llama 4 Scout vision) into the XR score every 3 s, as the 2D app does (`app/lib/groqScoring.ts`). Capture from `session.camera` and the reference video.
- [x] **T8 Session summary in XR** (Aryan): the report card appears after each full play-through (see How it works, step 8). Verified end to end in the emulator with `scripts/xr-verify.mjs`.

**P2, nice to have**
- [ ] **T9 Backup demo video**: screen-record the IWER emulator run and the real headset cast. Upload it and add it to the submission links.
- [x] **T10 Submission copy**: draft below. Confirm the production URL works signed-out and on another device.
- [ ] YouTube in production: set `YTDLP_PROXY` (residential) so `/api/download` works from Vercel without the laptop.
- [ ] Generation mode: rebuild "describe a move → AI video" on AI Gateway video models (`experimental_generateVideo`, e.g. `google/veo-3.1-fast-generate-001`) to replace the old Perplexity/HeyGen/xAI path in `app/api/generate`.

## Demo plan

Based on our earlier demo video ([youtube.com/watch?v=kL3udtWY1EE](https://www.youtube.com/watch?v=kL3udtWY1EE), 2:18). What worked there: a skit-based problem setup in the first 20 s, a **real coach line heard out loud**, an on-camera "it told me my arms are off" moment, and a funny ending (the "F" report card). What we change: that video spent 50 s on breadth (Zoom and generate modes). VR judges score *fun*, *creativity and use of VR*, and *execution*, so we spend that time on the mirror, presence and the spatial layout.

### Two deliverables, one shoot

**A. Recorded video, 75–90 s** (link it in the submission; Round 1 judges see only the submission)

| Time | Shot | Source |
| --- | --- | --- |
| 0:00–0:08 | **Skit:** teammate at a mirror, phone propped up playing a dance tutorial, flailing: *"I've watched this twenty times. What are my arms even doing?"* | Phone |
| 0:08–0:12 | Puts on the Quest. Title: **Mirror Coach: your mirror finally talks back.** | Phone |
| 0:12–0:40 | **Hero:** headset POV. The reflection with the colored skeleton, limb labels and dashed ghost; the reference on the left; score climbing. Press **X**: the reference flies to the top. | Quest recording or cast |
| 0:40–0:55 | **The fix-it moment:** the coach says something specific (e.g. "right arm higher") → the dancer fixes it → that limb turns green → the score jumps. React like the earlier video did. | Quest POV, then a phone over-the-shoulder shot of the real setup |
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

Paste-ready copy for the portal (refreshed 3:10pm, T10). Production URLs checked signed-out with `curl`: `/xr`, `/` and `/api/library` all return 200.

**Project name:** Mirror Coach

**Track:** VR Apps

**Public deployed URL:** https://vercel-ff-five.vercel.app/xr (2D version for a laptop webcam: https://vercel-ff-five.vercel.app/)

**Social links:** https://github.com/aryankeluskar/vercel_ff · backup demo video (T9)

**Description:**

Mirror Coach is a mixed-reality dance and fitness coach for Meta Quest 3. It's for anyone who learns moves from online videos. A video shows you the move and a mirror shows you yourself, but neither tells you what you're doing wrong.

You stand in front of a real mirror wearing the Quest. The headset's passthrough camera watches your reflection, and Mirror Coach draws your skeleton on top of it, each limb colored and labelled by how closely it matches the reference, with a ghost of the instructor's pose fitted to your body. The reference video hangs beside the mirror. A voice coach gives one specific correction every few seconds. After each full play-through, a report card shows your grade, a per-limb breakdown and tips.

- **Clip library:** 15 curated clips (9 dance, 6 workout), each with a pose timeline computed offline, so nothing waits on analysis.
- **Overlay registration:** uses the Quest camera's own factory calibration (Camera2 intrinsics and extrinsics: a 72.7° × 57.8° crop, an 11° downward tilt, and the lens offset from the eyes). The overlay is anchored to the head pose at the moment each camera frame was captured, and the distance to the reflection is measured continuously from your torso size.
- **Hands only, no controllers:** pinch buttons for play, restart, layout and a calibration pad, a pinch "Go again" on the report card, and a raise-both-hands gesture to resume.
- **Agent-native tooling:** a `window.mirrorCoach.agent` API (help, status, log, do), a script that drives a real Quest over ADB, and a headless verifier that runs the whole flow in Meta's IWER emulator before XR changes ship.

Technologies: Meta Immersive Web SDK (WebXR `immersive-ar` with passthrough and hand tracking), the Quest passthrough camera through `getUserMedia`, MediaPipe Pose in the browser, Next.js on Vercel, Vercel Blob for videos and pose timelines, and the AI SDK through Vercel AI Gateway with fallback models for every task: Llama 4 Scout writes the coach lines, Llama 4 Maverick writes the report card, OpenAI TTS speaks them.

How it meets the VR Apps criteria: Mirror Coach is an immersive WebXR mixed-reality session that runs in Quest Browser from a live Vercel HTTPS URL, with nothing to install. We tested it end to end on a real Quest 3 in front of a mirror.

**Demo setup instructions:**

1. Meta Quest 3 (Quest Browser) and a mirror, full-length if possible. No login or account.
2. Stand 1.5–2 m from the mirror, facing it.
3. Open https://vercel-ff-five.vercel.app/xr, tap **Allow camera** and accept the prompt, pick a clip, then tap **Enter Mirror (MR)**.
4. Hands are enough; no controllers needed. Point and pinch the buttons under the HUD, or raise both hands to resume a paused clip.
5. Backup demo video: (T9 link).
