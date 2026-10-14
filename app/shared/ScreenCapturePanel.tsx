"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { loadPose, POSE_CONNECTIONS } from "./pose";
import type { NormalizedLandmark, PoseResults } from "./pose";
import { withPoseLock } from "./poseMutex";
import { LandmarkSmoother } from "./landmarkSmoother";

type Props = {
  onPose: (landmarks: NormalizedLandmark[] | null) => void;
  onStop?: () => void;
  onAspectRatio?: (ratio: number) => void;
};

export default function ScreenCapturePanel({ onPose, onStop, onAspectRatio }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const animFrameRef = useRef<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseRef = useRef<any>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const smootherRef = useRef(new LandmarkSmoother());

  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;

  const processFrame = useCallback(async () => {
    if (!activeRef.current) return;

    const video = videoRef.current;
    const pose = poseRef.current;

    if (video && pose && video.readyState >= 2) {
      let offscreen = offscreenRef.current;
      if (!offscreen) {
        offscreen = document.createElement("canvas");
        offscreenRef.current = offscreen;
      }
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      if (offscreen.width !== vw || offscreen.height !== vh) {
        offscreen.width = vw;
        offscreen.height = vh;
      }
      const ctx = offscreen.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, offscreen.width, offscreen.height);
        try {
          await withPoseLock(() => pose.send({ image: offscreen }));
        } catch {
          // transient error
        }
      }
    }

    if (activeRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame);
    }
  }, []);

  const stopCapture = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    smootherRef.current.reset();
    poseRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCapturing(false);
  }, []);

  const startCapture = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      streamRef.current = stream;

      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopCapture();
        onStop?.();
      });

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => {});

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) { resolve(); return; }
        video.addEventListener("loadeddata", () => resolve(), { once: true });
      });

      console.log(`[ScreenCapture] Video ready: ${video.videoWidth}x${video.videoHeight}`);

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onAspectRatio?.(video.videoWidth / video.videoHeight);
      }

      setCapturing(true);

      console.log("[ScreenCapture] Loading own Pose instance...");
      const pose = await loadPose();
      console.log("[ScreenCapture] Pose loaded");
      poseRef.current = pose;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pose as any).onResults((results: PoseResults) => {
        const raw = results.poseLandmarks ?? null;
        const landmarks = raw ? smootherRef.current.smooth(raw) : null;
        onPoseRef.current(landmarks);

        const canvas = skeletonCanvasRef.current;
        if (canvas && landmarks) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            const w = canvas.offsetWidth;
            const h = canvas.offsetHeight;
            if (canvasSizeRef.current.w !== w || canvasSizeRef.current.h !== h) {
              canvas.width = w;
              canvas.height = h;
              canvasSizeRef.current = { w, h };
            }
            drawSkeletonNoMirror(ctx, landmarks, canvas.width, canvas.height);
          }
        }
      });

      activeRef.current = true;
      animFrameRef.current = requestAnimationFrame(processFrame);
    } catch (err) {
      console.error("Screen capture error:", err);
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Screen sharing was cancelled.");
      } else {
        setError("Could not start screen capture.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStop, processFrame, onAspectRatio, stopCapture]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className={`w-full h-full object-contain bg-black ${capturing ? "" : "hidden"}`}
      />
      <canvas
        ref={skeletonCanvasRef}
        className={`absolute inset-0 w-full h-full pointer-events-none ${capturing ? "" : "hidden"}`}
      />

      {capturing && (
        <>
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-xs text-white/70">ZOOM CAPTURE</span>
          </div>
          <button
            onClick={() => { stopCapture(); onStop?.(); }}
            className="absolute top-3 right-3 bg-red-500/80 hover:bg-red-500 text-white text-xs px-3 py-1 rounded-full transition-colors cursor-pointer"
          >
            Stop
          </button>
        </>
      )}

      {!capturing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="text-center">
            <p className="text-white/60 text-sm mb-1">Capture your Zoom call</p>
            <p className="text-white/30 text-xs max-w-xs">
              Share your Zoom window so the AI coach can see the dancer and track their moves
            </p>
          </div>
          <button
            onClick={startCapture}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold text-sm hover:opacity-90 transition-opacity cursor-pointer"
          >
            Share Zoom Window
          </button>
          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}

function drawSkeletonNoMirror(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#00CCFF";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if ((la.visibility ?? 0) < 0.3 || (lb.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(la.x * width, la.y * height);
    ctx.lineTo(lb.x * width, lb.y * height);
    ctx.stroke();
  }

  ctx.fillStyle = "#FF6644";
  for (let i = 11; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (!lm || (lm.visibility ?? 0) < 0.3) continue;
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}
