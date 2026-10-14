"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { drawSkeleton } from "../lib/pose";
import type { NormalizedLandmark } from "../lib/pose";
import type { StripPoseTimeline } from "../lib/videoPoseExtractor";
import { normalizePose, comparePoses, classifyPose } from "../lib/poseComparison";

type Props = {
  timeline: StripPoseTimeline;
  currentTime: number;
  livePoseRef: React.RefObject<NormalizedLandmark[] | null>;
  onSeek: (time: number) => void;
  playbackRate?: number;
  referenceVideoAspectRatio?: number;
  webcamAspectRatio?: number;
};

const CARD_BASE_H = 128;
const VISIBLE_CARDS = 7;

const REF_STYLE = {
  mirror: false,
  strokeColor: "#00ffff",
  fillColor: "#0ef",
  lineWidth: 1.5,
  pointRadius: 2,
  opacity: 1,
  clear: true,
} as const;

export default function MoveQueue({ timeline, currentTime, livePoseRef, onSeek, playbackRate = 1, referenceVideoAspectRatio = 16/9, webcamAspectRatio = 4/3 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  // Track best score achieved per card index (persists as user dances through)
  const cardScoresRef = useRef<Map<number, number>>(new Map());
  const [cardScores, setCardScores] = useState<Map<number, number>>(new Map());

  // Calculate card dimensions based on video aspect ratio
  const CARD_W = Math.round(CARD_BASE_H * referenceVideoAspectRatio);
  const CARD_H = CARD_BASE_H;

  // Timeline is already sampled (e.g. every 2s) — just classify
  const samples = useMemo(() => {
    return timeline.map((frame, idx) => ({
      idx,
      time: frame.time,
      label: frame.landmarks.length > 0 ? classifyPose(frame.landmarks) : "\u2014",
    }));
  }, [timeline]);

  // Pre-render mini skeletons onto canvases once
  useEffect(() => {
    for (const sample of samples) {
      const canvas = canvasRefs.current.get(sample.idx);
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      const landmarks = timeline[sample.idx]?.landmarks ?? [];
      if (landmarks.length > 0) {
        drawSkeleton(ctx, landmarks, CARD_W, CARD_H, REF_STYLE);
      } else {
        ctx.clearRect(0, 0, CARD_W, CARD_H);
        ctx.fillStyle = "rgba(0, 255, 255, 0.1)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No pose", CARD_W / 2, CARD_H / 2);
      }
    }
  }, [samples, timeline, CARD_W, CARD_H]);

  // Find current sample index
  const currentSampleIdx = useMemo(() => {
    let closest = 0;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].time <= currentTime) {
        closest = i;
      } else {
        break;
      }
    }
    return closest;
  }, [samples, currentTime]);

  // rAF loop: draw live overlay + track per-card performance
  useEffect(() => {
    let raf: number;
    let lastScoreUpdate = 0;

    const draw = () => {
      const canvas = overlayCanvasRef.current;
      const live = livePoseRef.current;
      const sample = samples[currentSampleIdx];

      if (canvas && live && sample) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const refLandmarks = timeline[sample.idx]?.landmarks ?? [];

          if (refLandmarks.length > 0 && live.length > 0) {
            const normRef = normalizePose(refLandmarks, referenceVideoAspectRatio);
            const normLive = normalizePose(live, webcamAspectRatio);
            const comparison = comparePoses(normRef, normLive);

            drawSkeleton(ctx, normLive, CARD_W, CARD_H, {
              mirror: true,
              strokeColor: "#ff00aa",
              fillColor: "#ff2d95",
              lineWidth: 1.5,
              pointRadius: 1.5,
              opacity: 0.85,
              clear: true,
              connectionColors: comparison.connectionColors,
            });

            const now = performance.now();
            if (now - lastScoreUpdate > 250) {
              lastScoreUpdate = now;
              setMatchScore(comparison.overallScore);

              // Record best score for this card
              const prev = cardScoresRef.current.get(currentSampleIdx) ?? 0;
              if (comparison.overallScore > prev) {
                cardScoresRef.current.set(currentSampleIdx, comparison.overallScore);
                setCardScores(new Map(cardScoresRef.current));
              }
            }
          } else {
            ctx.clearRect(0, 0, CARD_W, CARD_H);
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [currentSampleIdx, samples, timeline, livePoseRef, CARD_W, CARD_H, referenceVideoAspectRatio, webcamAspectRatio]);

  const handleCardClick = useCallback(
    (time: number) => {
      onSeek(time);
    },
    [onSeek]
  );

  if (samples.length === 0) return null;

  const halfVisible = Math.floor(VISIBLE_CARDS / 2);
  const offsetX = -(currentSampleIdx - halfVisible) * (CARD_W + 12);

  // Scale transition duration inversely with playback rate
  // Slower video (0.5x) = slower transitions (600ms)
  // Faster video (2x) = faster transitions (150ms)
  const transitionDuration = 300 / playbackRate;

  return (
    <div className="w-full overflow-hidden" style={{ height: CARD_H + 44 }}>
      <div
        ref={containerRef}
        className="flex gap-3 items-end ease-out"
        style={{
          transform: `translateX(calc(50% - ${CARD_W / 2}px + ${offsetX}px))`,
          transition: `transform ${transitionDuration}ms ease-out`,
        }}
      >
        {samples.map((sample, i) => {
          const isCurrent = i === currentSampleIdx;
          const isPast = i < currentSampleIdx;
          const opacity = isCurrent ? 1 : isPast ? 0.35 : 0.55;

          const mins = Math.floor(sample.time / 60);
          const secs = Math.floor(sample.time % 60);
          const timestamp = `${mins}:${secs.toString().padStart(2, "0")}`;

          // Performance border color for past cards
          const perfScore = cardScores.get(i);
          let borderClass = "border-white/5";
          let glowClass = "";
          if (isCurrent) {
            borderClass = "border-neon-magenta/70 animate-card-glow";
          } else if (perfScore !== undefined) {
            if (perfScore >= 80) {
              borderClass = "border-neon-green/50";
              glowClass = "glow-green";
            } else if (perfScore >= 50) {
              borderClass = "border-neon-yellow/50";
              glowClass = "glow-yellow";
            } else {
              borderClass = "border-neon-red/50";
              glowClass = "glow-red";
            }
          }

          const thumbnail = timeline[sample.idx]?.thumbnail;

          return (
            <div
              key={sample.idx}
              className="flex flex-col items-center flex-shrink-0 transition-all duration-300 cursor-pointer"
              style={{ opacity }}
              onClick={() => handleCardClick(sample.time)}
            >
              <div
                className={`holo-card rounded border-2 overflow-hidden transition-all duration-300 ${borderClass} ${glowClass} ${
                  isCurrent ? "scale-110" : "hover:scale-105 hover:border-neon-cyan/20"
                }`}
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  position: "relative",
                  backgroundImage: thumbnail ? `url(${thumbnail})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundColor: thumbnail ? undefined : "rgba(5, 5, 15, 0.7)",
                }}
              >
                {/* Dark hologram tint */}
                <div
                  className={`holo-tint ${isCurrent ? "holo-tint-active" : ""}`}
                />

                {/* Scanline overlay */}
                <div
                  className={`holo-scanlines ${isCurrent ? "holo-scanlines-active" : ""}`}
                />

                {/* Reference skeleton canvas */}
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(sample.idx, el);
                  }}
                  width={CARD_W}
                  height={CARD_H}
                  style={{ position: "absolute", top: 0, left: 0, zIndex: 3 }}
                />

                {/* Live overlay canvas (active card only) */}
                {isCurrent && (
                  <canvas
                    ref={overlayCanvasRef}
                    width={CARD_W}
                    height={CARD_H}
                    style={{ position: "absolute", top: 0, left: 0, zIndex: 4 }}
                  />
                )}

                {/* Match score badge */}
                {isCurrent && matchScore !== null && (
                  <div
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      zIndex: 5,
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: "var(--font-audiowide)",
                      padding: "1px 5px",
                      borderRadius: 2,
                      background:
                        matchScore >= 80
                          ? "rgba(57, 255, 20, 0.9)"
                          : matchScore >= 50
                            ? "rgba(255, 225, 0, 0.9)"
                            : "rgba(255, 0, 60, 0.9)",
                      color: "#000",
                      lineHeight: 1.3,
                      boxShadow:
                        matchScore >= 80
                          ? "0 0 6px rgba(57, 255, 20, 0.5)"
                          : matchScore >= 50
                            ? "0 0 6px rgba(255, 225, 0, 0.5)"
                            : "0 0 6px rgba(255, 0, 60, 0.5)",
                    }}
                  >
                    {matchScore}
                  </div>
                )}
              </div>
              <span
                className={`text-[10px] mt-1 ${isCurrent ? "neon-text-cyan" : "text-white/25"}`}
                style={{ fontFamily: "var(--font-audiowide)" }}
              >
                {timestamp}
              </span>
              <span className={`text-[8px] leading-tight ${isCurrent ? "text-neon-magenta/60" : "text-white/15"}`}>
                {sample.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
