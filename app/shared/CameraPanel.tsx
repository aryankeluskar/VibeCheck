"use client";

import { useEffect, useRef, useCallback } from "react";
import { drawSkeleton, loadPose } from "./pose";
import type { NormalizedLandmark, PoseResults } from "./pose";
import { withPoseLock } from "./poseMutex";
import { LandmarkSmoother } from "./landmarkSmoother";

type Props = {
  onPose: (landmarks: NormalizedLandmark[] | null) => void;
  badge?: string;
  /** Optional: overlay segmented video */
  segmentedVideoUrl?: string | null;
  /** Optional: reference video time for syncing overlay */
  referenceVideoTime?: number;
};

export default function CameraPanel({ onPose, badge = "LIVE", segmentedVideoUrl, referenceVideoTime }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseRef = useRef<any>(null);
  const activeRef = useRef(true);
  const animRef = useRef(0);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const smootherRef = useRef(new LandmarkSmoother());

  // Sync overlay video time
  useEffect(() => {
    if (overlayVideoRef.current && referenceVideoTime !== undefined && segmentedVideoUrl) {
      const diff = Math.abs(overlayVideoRef.current.currentTime - referenceVideoTime);
      if (diff > 0.3) {
        overlayVideoRef.current.currentTime = referenceVideoTime;
      }
      if (overlayVideoRef.current.paused && referenceVideoTime > 0) {
        overlayVideoRef.current.play().catch(() => {});
      }
    }
  }, [referenceVideoTime, segmentedVideoUrl]);

  const processFrame = useCallback(async () => {
    if (!activeRef.current) return;

    const video = videoRef.current;
    const pose = poseRef.current;

    if (video && pose && video.readyState >= 2) {
      let oc = offscreenRef.current;
      if (!oc) {
        oc = document.createElement("canvas");
        offscreenRef.current = oc;
      }
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      if (oc.width !== vw || oc.height !== vh) {
        oc.width = vw;
        oc.height = vh;
      }
      const octx = oc.getContext("2d");
      if (octx) {
        octx.drawImage(video, 0, 0, oc.width, oc.height);
        try {
          await withPoseLock(() => pose.send({ image: oc }));
        } catch {
          // transient error
        }
      }
    }

    if (activeRef.current) {
      animRef.current = requestAnimationFrame(processFrame);
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    let stream: MediaStream | null = null;

    const init = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });

        if (!activeRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const pose = await loadPose();
        if (!activeRef.current) return;
        poseRef.current = pose;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pose as any).onResults((results: PoseResults) => {
          const raw = results.poseLandmarks ?? null;
          const landmarks = raw ? smootherRef.current.smooth(raw) : null;
          onPoseRef.current(landmarks);

          const canvas = canvasRef.current;
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
              drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
            }
          }
        });

        console.log("[Camera] Pose instance loaded, starting frame loop");
        animRef.current = requestAnimationFrame(processFrame);
      } catch (err) {
        console.error("Camera init error:", err);
      }
    };

    init();

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(animRef.current);
      smootherRef.current.reset();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [processFrame]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-white/10 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full h-full object-contain bg-black"
        style={{ transform: "scaleX(-1)" }}
      />
      {/* Overlay segmented video */}
      {segmentedVideoUrl && (
        <video
          ref={overlayVideoRef}
          src={segmentedVideoUrl}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ transform: "scaleX(-1)", mixBlendMode: "screen", opacity: 0.7 }}
        />
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs text-white/70">{badge}</span>
      </div>
    </div>
  );
}
