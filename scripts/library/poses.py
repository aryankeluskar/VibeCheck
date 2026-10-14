# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["mediapipe>=0.10.14", "opencv-python-headless"]
# ///
"""
Offline pose timeline for a reference clip, in the same shape the browser
extractor writes to poses/<id>.v1.json: [{time, landmarks: [{x,y,z,visibility}] x33}].

Also prints quality stats as one JSON line on stderr so the ingest script can
reject clips that won't coach well (cropped legs, groups, side-on camera).

  uv run scripts/library/poses.py clip.mp4 out.json [--model heavy.task] [--step 0.25]
"""

import argparse
import json
import statistics
import sys

import cv2
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

NOSE, L_SH, R_SH, L_WR, R_WR, L_HIP, R_HIP, L_ANK, R_ANK = 0, 11, 12, 15, 16, 23, 24, 27, 28


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--model", default=".tools/models/pose_landmarker_heavy.task")
    ap.add_argument("--step", type=float, default=0.25)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    aspect = w / h if h else 1

    landmarker = PoseLandmarker.create_from_options(
        PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=args.model),
            running_mode=RunningMode.VIDEO,
            num_poses=2,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )

    timeline, full, multi, heights, facing, motion = [], 0, 0, [], [], []
    next_t, frame_idx, prev, last_hip = 0.0, 0, None, None
    hip_x = lambda p: (p[L_HIP].x + p[R_HIP].x) / 2
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = frame_idx / fps
        frame_idx += 1
        if t + 1e-6 < next_t:
            continue
        next_t += args.step
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(t * 1000)
        )
        poses = res.pose_landmarks or []
        if len(poses) > 1:
            multi += 1
        # Follow one performer: the person nearest the last pick, else the biggest.
        if not poses:
            lms = []
        elif last_hip is not None:
            lms = min(poses, key=lambda p: abs(hip_x(p) - last_hip))
        else:
            lms = max(poses, key=lambda p: max(l.y for l in p) - min(l.y for l in p))
        if lms:
            last_hip = hip_x(lms)
        timeline.append(
            {
                "time": round(t, 3),
                "landmarks": [
                    {
                        "x": round(l.x, 4),
                        "y": round(l.y, 4),
                        "z": round(l.z, 4),
                        "visibility": round(l.visibility, 3),
                    }
                    for l in lms
                ],
            }
        )
        if not lms:
            prev = None
            continue
        key = [lms[i] for i in (NOSE, L_WR, R_WR, L_ANK, R_ANK)]
        if all(l.visibility > 0.5 and -0.02 <= l.y <= 1.02 and -0.02 <= l.x <= 1.02 for l in key):
            full += 1
        heights.append(max(l.y for l in lms) - min(l.y for l in lms))
        torso = abs((lms[L_SH].y + lms[R_SH].y) / 2 - (lms[L_HIP].y + lms[R_HIP].y) / 2)
        if torso > 0.02:
            facing.append(abs(lms[L_SH].x - lms[R_SH].x) * aspect / torso)
        if prev:
            motion.append(sum(abs(a.x - b.x) + abs(a.y - b.y) for a, b in zip(lms, prev)) / 33)
        prev = lms

    n = len(timeline)
    detected = sum(1 for f in timeline if f["landmarks"])
    stats = {
        "frames": n,
        "duration": round(frame_idx / fps, 1),
        "size": f"{int(w)}x{int(h)}",
        "detected": round(detected / n, 2) if n else 0,
        "fullBody": round(full / n, 2) if n else 0,
        "multiPerson": round(multi / n, 2) if n else 0,
        "bodyHeight": round(statistics.median(heights), 2) if heights else 0,
        # shoulder width / torso length; ~0.6+ is front-on, <0.3 is side-on
        "facing": round(statistics.median(facing), 2) if facing else 0,
        "motion": round(statistics.mean(motion), 4) if motion else 0,
    }
    with open(args.out, "w") as f:
        json.dump(timeline, f, separators=(",", ":"))
    print(json.dumps(stats), file=sys.stderr)


if __name__ == "__main__":
    main()
