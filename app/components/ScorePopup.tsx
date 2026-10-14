"use client";

import { useEffect, useState, useRef } from "react";

type ScoreType = "perfect" | "great" | "ok" | "almost" | "miss";

type Props = {
  score: ScoreType | null;
  points: number;
  onComplete?: () => void;
};

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNER_POSITIONS: Record<Corner, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
};

const SCORE_COLORS: Record<ScoreType, { primary: string; secondary: string; glow: string; text: string }> = {
  perfect: { primary: "rgba(57, 255, 20, 1)", secondary: "rgba(0, 255, 170, 1)", glow: "rgba(57, 255, 20, 0.8)", text: "#39ff14" },
  great: { primary: "rgba(255, 225, 0, 1)", secondary: "rgba(255, 170, 0, 1)", glow: "rgba(255, 225, 0, 0.8)", text: "#ffe100" },
  ok: { primary: "rgba(0, 180, 255, 1)", secondary: "rgba(0, 255, 255, 1)", glow: "rgba(0, 180, 255, 0.6)", text: "#00b4ff" },
  almost: { primary: "rgba(255, 100, 0, 1)", secondary: "rgba(255, 50, 50, 1)", glow: "rgba(255, 100, 0, 0.6)", text: "#ff6400" },
  miss: { primary: "rgba(255, 0, 60, 1)", secondary: "rgba(150, 0, 60, 1)", glow: "rgba(255, 0, 60, 0.5)", text: "#ff003c" },
};

const SCORE_LABELS: Record<ScoreType, string> = {
  perfect: "PERFECT",
  great: "GREAT",
  ok: "OK",
  almost: "ALMOST",
  miss: "MISS",
};

export default function ScorePopup({ score, points, onComplete }: Props) {
  const [isVisible, setIsVisible] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [corner, setCorner] = useState<Corner>("top-right");
  const [displayScore, setDisplayScore] = useState<ScoreType | null>(null);
  const [displayPoints, setDisplayPoints] = useState(0);

  const isShowingRef = useRef(false);
  const lastShownScoreRef = useRef<ScoreType | null>(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (score && !isShowingRef.current && score !== lastShownScoreRef.current) {
      isShowingRef.current = true;
      lastShownScoreRef.current = score;
      setDisplayScore(score);
      setDisplayPoints(points);

      setRotation(Math.random() * 50 - 25);

      const corners: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
      setCorner(corners[Math.floor(Math.random() * corners.length)]);

      setIsVisible(true);

      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => {
          isShowingRef.current = false;
          onCompleteRef.current?.();
        }, 400);
      }, 1500);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [score, points]);

  useEffect(() => {
    if (score === null) {
      isShowingRef.current = false;
      lastShownScoreRef.current = null;
      setDisplayScore(null);
      setIsVisible(false);
    }
  }, [score]);

  if (!displayScore) return null;

  const colors = SCORE_COLORS[displayScore];
  const isHighScore = displayScore === "perfect" || displayScore === "great";
  const isMiss = displayScore === "miss";
  const particleCount = isHighScore ? 30 : isMiss ? 8 : 20;

  return (
    <>
      {isHighScore && isVisible && (
        <div className="fixed inset-0 pointer-events-none z-50 score-screen-shake" />
      )}

      <div
        className={`absolute ${CORNER_POSITIONS[corner]} pointer-events-none z-50 transition-opacity duration-400 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Radial burst lines */}
        {isVisible && (
          <div className="absolute inset-0 flex items-center justify-center">
            {[...Array(12)].map((_, i) => (
              <div
                key={`burst-${i}`}
                className="score-burst-line absolute"
                style={{
                  background: `linear-gradient(90deg, ${colors.primary}, transparent)`,
                  transform: `rotate(${i * 30}deg)`,
                  transformOrigin: "left center",
                  left: "50%",
                  top: "50%",
                }}
              />
            ))}
          </div>
        )}

        {/* Particle burst */}
        {isVisible && (
          <div className="absolute inset-0 flex items-center justify-center">
            {[...Array(particleCount)].map((_, i) => {
              const angle = (i / particleCount) * Math.PI * 2;
              const distance = 100 + Math.random() * 100;
              const size = 4 + Math.random() * 8;
              const delay = Math.random() * 100;

              return (
                <div
                  key={`particle-${i}`}
                  className="score-particle absolute rounded-full"
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                    background: i % 2 === 0 ? colors.primary : colors.secondary,
                    boxShadow: `0 0 ${size * 2}px ${colors.glow}`,
                    left: "50%",
                    top: "50%",
                    animationDelay: `${delay}ms`,
                    "--particle-x": `${Math.cos(angle) * distance}px`,
                    "--particle-y": `${Math.sin(angle) * distance}px`,
                  } as React.CSSProperties}
                />
              );
            })}
          </div>
        )}

        {/* Expanding ring */}
        {isVisible && (
          <>
            <div
              className="score-ring-burst absolute rounded-full"
              style={{
                border: `4px solid ${colors.primary}`,
                boxShadow: `0 0 30px ${colors.glow}, inset 0 0 30px ${colors.glow}`,
              }}
            />
            <div
              className="score-ring-burst absolute rounded-full"
              style={{
                border: `3px solid ${colors.secondary}`,
                boxShadow: `0 0 20px ${colors.glow}`,
                animationDelay: "150ms",
              }}
            />
          </>
        )}

        {/* Badge image + points */}
        <div
          className={`score-popup ${isVisible ? "score-popup-enter" : ""}`}
          style={{ transform: `rotate(${rotation}deg) scale(${isVisible ? 1 : 0.3})` }}
        >
          {isVisible && (
            <div
              className="score-glow-pulse absolute inset-0 rounded-full blur-3xl"
              style={{ background: `radial-gradient(circle, ${colors.glow}, transparent)` }}
            />
          )}

          <div className="relative flex flex-col items-center">
            {/* Original badge image */}
            <img
              src={`/score/${displayScore}.png`}
              alt={displayScore}
              className="relative w-48 h-auto drop-shadow-2xl"
              style={{
                filter: `drop-shadow(0 0 30px ${colors.glow}) drop-shadow(0 0 60px ${colors.primary})`,
              }}
            />

            {/* Points below the badge */}
            <div
              style={{
                fontSize: displayPoints > 0 ? "clamp(1.8rem, 5vw, 3rem)" : "clamp(1.2rem, 3vw, 2rem)",
                fontWeight: 900,
                lineHeight: 1,
                color: colors.text,
                textShadow: `0 0 10px ${colors.glow}, 0 0 30px ${colors.glow}, 0 0 60px ${colors.primary}`,
                fontFamily: "var(--font-audiowide)",
                WebkitTextStroke: `1px ${colors.primary}`,
                marginTop: "4px",
              }}
            >
              {displayPoints > 0 ? `+${displayPoints}` : "0"}
            </div>
          </div>
        </div>

        <style jsx>{`
          .score-popup {
            position: relative;
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .score-popup-enter {
            animation: explosive-bang-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
          }

          @keyframes explosive-bang-in {
            0% {
              transform: rotate(${rotation}deg) scale(0);
              opacity: 0;
              filter: blur(20px);
            }
            40% {
              transform: rotate(${rotation + 10}deg) scale(1.8);
              opacity: 1;
              filter: blur(0);
            }
            60% {
              transform: rotate(${rotation - 5}deg) scale(1.5);
            }
            80% {
              transform: rotate(${rotation + 3}deg) scale(0.85);
            }
            100% {
              transform: rotate(${rotation}deg) scale(1);
              opacity: 1;
              filter: blur(0);
            }
          }

          .score-particle {
            animation: particle-explode 1s ease-out forwards;
          }

          @keyframes particle-explode {
            0% {
              transform: translate(-50%, -50%) scale(1);
              opacity: 1;
            }
            70% { opacity: 1; }
            100% {
              transform: translate(
                calc(-50% + var(--particle-x)),
                calc(-50% + var(--particle-y))
              ) scale(0);
              opacity: 0;
            }
          }

          .score-burst-line {
            width: 200px;
            height: 4px;
            animation: burst-expand 0.6s ease-out forwards;
          }

          @keyframes burst-expand {
            0% { width: 0; opacity: 1; }
            50% { opacity: 1; }
            100% { width: 200px; opacity: 0; }
          }

          .score-ring-burst {
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 20px;
            height: 20px;
            animation: ring-expand 0.8s ease-out forwards;
          }

          @keyframes ring-expand {
            0% { width: 20px; height: 20px; opacity: 1; }
            100% { width: 400px; height: 400px; opacity: 0; }
          }

          .score-glow-pulse {
            animation: glow-pulse 0.6s ease-in-out 3;
          }

          @keyframes glow-pulse {
            0%, 100% { opacity: 0.5; transform: scale(0.8); }
            50% { opacity: 1; transform: scale(1.3); }
          }

          .score-screen-shake {
            animation: screen-shake 0.4s ease-in-out;
          }

          @keyframes screen-shake {
            0%, 100% { transform: translate(0, 0); }
            10% { transform: translate(-4px, 2px); }
            20% { transform: translate(4px, -2px); }
            30% { transform: translate(-3px, -3px); }
            40% { transform: translate(3px, 3px); }
            50% { transform: translate(-2px, 1px); }
            60% { transform: translate(2px, -1px); }
            70% { transform: translate(-1px, -2px); }
            80% { transform: translate(1px, 2px); }
            90% { transform: translate(-1px, 1px); }
          }
        `}</style>
      </div>
    </>
  );
}

/** Point values for each score type (increments of 5) */
export const SCORE_POINTS: Record<ScoreType, number> = {
  perfect: 25,
  great: 20,
  ok: 15,
  almost: 10,
  miss: 0,
};

export function getScoreType(score: number): ScoreType {
  if (score >= 90) return "perfect";
  if (score >= 80) return "great";
  if (score >= 60) return "ok";
  if (score >= 40) return "almost";
  return "miss";
}
