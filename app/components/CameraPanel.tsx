"use client";

import { useEffect, useRef, useCallback } from "react";
import { drawSkeleton, loadPose } from "../lib/pose";
import { extractOutline, extractMask } from "../lib/outlineExtractor";
import { captureVideoFrame } from "../lib/frameCapture";
import type { NormalizedLandmark, PoseResults } from "../lib/pose";

type Props = {
  onPose: (landmarks: NormalizedLandmark[] | null) => void;
  segmentedVideoUrl?: string | null;
  referenceVideoTime?: number;
  playbackRate?: number;
  isReferencePaused?: boolean;
  referenceVideoAspectRatio?: number;
  webcamCaptureRef?: React.MutableRefObject<(() => string | null) | null>;
  webcamStreamRef?: React.MutableRefObject<MediaStream | null>;
  onWebcamAspectRatio?: (aspectRatio: number) => void;
  referencePose?: NormalizedLandmark[] | null;
  livePose?: NormalizedLandmark[] | null;
};

const NEON_SKELETON_STYLE = {
  mirror: true,
  strokeColor: "#00ffff",
  fillColor: "#ff00aa",
  lineWidth: 3,
  pointRadius: 5,
  opacity: 1,
  clear: true,
} as const;

/**
 * Calculate bounding box for a pose (min/max x/y)
 */
function getPoseBounds(landmarks: NormalizedLandmark[]): { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number; width: number; height: number } | null {
  if (!landmarks || landmarks.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  // Use torso + arms for bounds (landmarks 11-16, 23-24)
  const keyIndices = [11, 12, 13, 14, 15, 16, 23, 24];

  for (const idx of keyIndices) {
    const lm = landmarks[idx];
    if (!lm || (lm.visibility ?? 0) < 0.3) continue;

    minX = Math.min(minX, lm.x);
    maxX = Math.max(maxX, lm.x);
    minY = Math.min(minY, lm.y);
    maxY = Math.max(maxY, lm.y);
  }

  if (minX === Infinity) return null;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const width = maxX - minX;
  const height = maxY - minY;

  return { minX, maxX, minY, maxY, centerX, centerY, width, height };
}

export default function CameraPanel({ onPose, segmentedVideoUrl, referenceVideoTime, playbackRate = 1, isReferencePaused = false, referenceVideoAspectRatio = 16/9, webcamCaptureRef, webcamStreamRef, onWebcamAspectRatio, referencePose, livePose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const poseRef = useRef<unknown>(null);
  const animFrameRef = useRef<number>(0);
  const activeRef = useRef(true);
  const overlayRafRef = useRef<number>(0);

  // Refs for values that change frequently (to avoid restarting rAF loop)
  const referenceVideoTimeRef = useRef(referenceVideoTime);
  const isReferencePausedRef = useRef(isReferencePaused);
  const referencePoseRef = useRef(referencePose);
  const livePoseRef = useRef(livePose);

  // Update refs when props change
  referenceVideoTimeRef.current = referenceVideoTime;
  isReferencePausedRef.current = isReferencePaused;
  referencePoseRef.current = referencePose;
  livePoseRef.current = livePose;

  // Create offscreen temp canvases for outline and mask extraction
  useEffect(() => {
    if (!tempCanvasRef.current) {
      tempCanvasRef.current = document.createElement("canvas");
      tempCanvasRef.current.width = 640;
      tempCanvasRef.current.height = 480;
    }
    if (!tempMaskCanvasRef.current) {
      tempMaskCanvasRef.current = document.createElement("canvas");
      tempMaskCanvasRef.current.width = 640;
      tempMaskCanvasRef.current.height = 480;
    }
  }, []);

  // Load and play the segmented overlay video when URL changes
  useEffect(() => {
    const video = overlayVideoRef.current;
    if (!video || !segmentedVideoUrl) return;

    video.crossOrigin = "anonymous";
    video.src = segmentedVideoUrl;
    video.loop = true;
    video.muted = true;
    video.playbackRate = playbackRate;
    video.play().catch((err) => {
      console.error("Overlay video play failed:", err);
    });
  }, [segmentedVideoUrl, playbackRate]);

  // Update playback rate when it changes
  useEffect(() => {
    const video = overlayVideoRef.current;
    if (!video || !segmentedVideoUrl) return;
    video.playbackRate = playbackRate;
  }, [playbackRate, segmentedVideoUrl]);

  // Note: Sync is now handled in the render loop below for better accuracy

  // Render the outline overlay on a separate canvas via rAF
  useEffect(() => {
    if (!segmentedVideoUrl) return;

    const renderOverlay = () => {
      const overlayVideo = overlayVideoRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      const tempCanvas = tempCanvasRef.current;
      const tempMaskCanvas = tempMaskCanvasRef.current;

      // Continuous sync: keep overlay video perfectly synced with reference
      const refTime = referenceVideoTimeRef.current;
      const refPaused = isReferencePausedRef.current;

      if (overlayVideo && refTime !== undefined && overlayVideo.readyState >= 2) {
        // Sync play/pause state
        if (refPaused && !overlayVideo.paused) {
          overlayVideo.pause();
        } else if (!refPaused && overlayVideo.paused) {
          overlayVideo.play().catch(() => {
            // Ignore play failures
          });
        }

        // Tight sync: reduce drift threshold to 0.05s (50ms) for near-perfect sync
        const drift = Math.abs(overlayVideo.currentTime - refTime);
        if (drift > 0.05) {
          overlayVideo.currentTime = refTime;
        }
      }

      if (overlayCanvas && overlayVideo && tempCanvas && overlayVideo.readyState >= 2) {
        overlayCanvas.width = overlayCanvas.offsetWidth;
        overlayCanvas.height = overlayCanvas.offsetHeight;

        const ctx = overlayCanvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

          // Calculate aspect-ratio-fitted rectangle (like object-fit: contain)
          const containerWidth = overlayCanvas.width;
          const containerHeight = overlayCanvas.height;
          const containerAspect = containerWidth / containerHeight;

          let drawWidth, drawHeight, offsetX, offsetY;

          if (referenceVideoAspectRatio > containerAspect) {
            // Video is wider than container - fit to width
            drawWidth = containerWidth;
            drawHeight = containerWidth / referenceVideoAspectRatio;
            offsetX = 0;
            offsetY = (containerHeight - drawHeight) / 2;
          } else {
            // Video is taller than container - fit to height
            drawHeight = containerHeight;
            drawWidth = containerHeight * referenceVideoAspectRatio;
            offsetX = (containerWidth - drawWidth) / 2;
            offsetY = 0;
          }

          // Resize temp canvases to match the fitted video size
          tempCanvas.width = drawWidth;
          tempCanvas.height = drawHeight;
          if (tempMaskCanvas) {
            tempMaskCanvas.width = drawWidth;
            tempMaskCanvas.height = drawHeight;
          }

          // Calculate transformation parameters (used for both mask and outline)
          const refBounds = referencePoseRef.current ? getPoseBounds(referencePoseRef.current) : null;
          const liveBounds = livePoseRef.current ? getPoseBounds(livePoseRef.current) : null;

          let transform: {
            scale: number;
            refCenterX: number;
            refCenterY: number;
            liveCenterX: number;
            liveCenterY: number;
          } | null = null;

          if (refBounds && liveBounds) {
            const scaleX = liveBounds.width / refBounds.width;
            const scaleY = liveBounds.height / refBounds.height;
            const baseScale = Math.min(scaleX, scaleY);
            const scale = baseScale * 1.8; // Boost scale to make overlay more visible

            const refCenterX = offsetX + refBounds.centerX * drawWidth;
            const refCenterY = offsetY + refBounds.centerY * drawHeight;
            const liveCenterX = (1 - liveBounds.centerX) * containerWidth; // Mirrored
            const liveCenterY = liveBounds.centerY * containerHeight;

            transform = { scale, refCenterX, refCenterY, liveCenterX, liveCenterY };
          }

          // 1. First draw background dimming mask
          if (tempMaskCanvas) {
            const maskData = extractMask(overlayVideo, tempMaskCanvas);
            if (maskData) {
              const tempMaskCtx = tempMaskCanvas.getContext("2d");
              if (tempMaskCtx) {
                tempMaskCtx.putImageData(maskData, 0, 0);

                if (transform) {
                  ctx.save();
                  ctx.translate(transform.liveCenterX, transform.liveCenterY);
                  ctx.scale(transform.scale, transform.scale);
                  ctx.translate(-transform.refCenterX, -transform.refCenterY);
                  ctx.drawImage(tempMaskCanvas, offsetX, offsetY, drawWidth, drawHeight);
                  ctx.restore();
                } else {
                  ctx.drawImage(tempMaskCanvas, offsetX, offsetY, drawWidth, drawHeight);
                }
              }
            }
          }

          // 2. Then draw outline on top
          const outlineData = extractOutline(overlayVideo, tempCanvas);
          if (outlineData) {
            const tempCtx = tempCanvas.getContext("2d");
            if (tempCtx) {
              tempCtx.putImageData(outlineData, 0, 0);

              if (transform) {
                ctx.save();
                ctx.translate(transform.liveCenterX, transform.liveCenterY);
                ctx.scale(transform.scale, transform.scale);
                ctx.translate(-transform.refCenterX, -transform.refCenterY);
                ctx.drawImage(tempCanvas, offsetX, offsetY, drawWidth, drawHeight);
                ctx.restore();
              } else {
                ctx.drawImage(tempCanvas, offsetX, offsetY, drawWidth, drawHeight);
              }
            }
          }
        }
      }

      overlayRafRef.current = requestAnimationFrame(renderOverlay);
    };

    overlayRafRef.current = requestAnimationFrame(renderOverlay);

    return () => {
      cancelAnimationFrame(overlayRafRef.current);
    };
  }, [segmentedVideoUrl, referenceVideoAspectRatio]);

  const processFrame = useCallback(async () => {
    if (!activeRef.current) return;
    const video = videoRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pose = poseRef.current as any;

    if (video && pose && video.readyState >= 2) {
      try {
        await pose.send({ image: video });
      } catch {
        // pose may not be ready yet
      }
    }

    if (activeRef.current) {
      animFrameRef.current = requestAnimationFrame(processFrame);
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

        if (webcamStreamRef) {
          webcamStreamRef.current = stream;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          // Report webcam aspect ratio once video is ready
          if (onWebcamAspectRatio && videoRef.current.videoWidth && videoRef.current.videoHeight) {
            const aspectRatio = videoRef.current.videoWidth / videoRef.current.videoHeight;
            onWebcamAspectRatio(aspectRatio);
          }

          if (webcamCaptureRef) {
            webcamCaptureRef.current = () =>
              videoRef.current ? captureVideoFrame(videoRef.current, false) : null;
          }
        }

        const pose = await loadPose();
        poseRef.current = pose;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pose as any).onResults((results: PoseResults) => {
          const landmarks = results.poseLandmarks ?? null;
          onPose(landmarks);

          const canvas = canvasRef.current;
          if (canvas && landmarks) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              canvas.width = canvas.offsetWidth;
              canvas.height = canvas.offsetHeight;
              drawSkeleton(ctx, landmarks, canvas.width, canvas.height, NEON_SKELETON_STYLE);
            }
          } else if (canvas) {
            const ctx = canvas.getContext("2d");
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
          }
        });

        // Start processing frames
        animFrameRef.current = requestAnimationFrame(processFrame);
      } catch (err) {
        console.error("Camera/Pose init error:", err);
      }
    };

    init();

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(animFrameRef.current);
      if (webcamStreamRef) {
        webcamStreamRef.current = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onPose, processFrame, webcamCaptureRef, webcamStreamRef]);

  return (
    <div className="relative w-full h-full rounded overflow-hidden border border-neon-magenta/15 bg-black glow-magenta">
      {/* HUD corners — magenta theme for camera */}
      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-neon-magenta/50 z-10" />
      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-neon-magenta/50 z-10" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-neon-magenta/50 z-10" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-neon-magenta/50 z-10" />

      {/* Panel label */}
      <div
        className="absolute top-2 left-3 z-10 text-[8px] tracking-[0.3em] uppercase text-neon-magenta/35"
        style={{ fontFamily: "var(--font-audiowide)" }}
      >
        Your Move
      </div>

      {/* Webcam video */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Skeleton overlay canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Segmented outline overlay canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0.7 }}
      />

      {/* Hidden overlay video for segmented mask */}
      {segmentedVideoUrl && (
        <video
          ref={overlayVideoRef}
          playsInline
          muted
          className="hidden"
        />
      )}

      {/* Live indicator */}
      <div className="absolute top-2 right-3 z-10 flex items-center gap-2 bg-black/70 px-2.5 py-1 border border-neon-red/30 rounded-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-neon-red animate-live-dot" />
        <span
          className="text-[9px] tracking-[0.2em] text-neon-red/80 uppercase"
          style={{ fontFamily: "var(--font-audiowide)" }}
        >
          Live
        </span>
      </div>
    </div>
  );
}
