"use client";

import { QRCodeSVG } from "qrcode.react";
import type { AIReport } from "./types";
import type { AppMode } from "../../shared/mode";
import { getGradeColors } from "./types";

type Props = {
  report: AIReport;
  active: boolean;
  onClose: () => void;
  mode: AppMode;
  recordingUrl?: string;
  recordingUploading?: boolean;
};

export default function SlideLevelUp({ report, active, onClose, mode, recordingUrl, recordingUploading }: Props) {
  const isGym = mode === "gym";
  const gc = getGradeColors(report.grade, mode);

  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center px-8 transition-opacity duration-500 ${
        active ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Title */}
      <div
        className={`text-base tracking-[0.5em] uppercase mb-10 ${isGym ? "" : "neon-text-cyan"}`}
        style={{
          fontFamily: "var(--font-audiowide)",
          ...(isGym ? {
            color: gc.color,
            textShadow: `0 0 7px ${gc.glow}, 0 0 20px ${gc.glow}`,
          } : {}),
        }}
      >
        {isGym ? "Next Session" : "Level Up"}
      </div>

      {/* Tips */}
      <div className="w-full max-w-lg flex flex-col gap-5">
        {report.tips.map((tip, i) => (
          <div
            key={i}
            className={`flex gap-4 items-start ${active ? "report-stat-pop" : ""}`}
            style={{ animationDelay: `${0.2 + i * 0.15}s` }}
          >
            <div
              className="w-1.5 self-stretch rounded-full flex-shrink-0"
              style={{
                background: `linear-gradient(180deg, ${gc.color}, ${gc.glow})`,
                boxShadow: `0 0 8px ${gc.glow}`,
              }}
            />
            <p
              className="text-base leading-relaxed"
              style={{
                fontFamily: "var(--font-chakra-petch)",
                color: "rgba(224, 224, 255, 0.9)",
              }}
            >
              {tip}
            </p>
          </div>
        ))}
      </div>

      {/* Summary */}
      <p
        className={`mt-10 text-center max-w-md animate-glow-pulse ${active ? "report-subtitle-pop" : ""} ${isGym ? "" : "neon-text-cyan"}`}
        style={{
          fontSize: "clamp(1.05rem, 2.8vw, 1.35rem)",
          fontFamily: "var(--font-chakra-petch)",
          animationDelay: "0.6s",
          ...(isGym ? {
            color: gc.color,
            textShadow: `0 0 7px ${gc.glow}, 0 0 20px ${gc.glow}`,
          } : {}),
        }}
      >
        {report.summary}
      </p>

      {/* QR Code for performance recording */}
      {recordingUrl ? (
        <div
          className={`mt-8 flex flex-col items-center gap-2 ${active ? "report-stat-pop" : ""}`}
          style={{ animationDelay: "0.8s" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="p-3 rounded-lg"
            style={{
              background: "rgba(0, 0, 0, 0.6)",
              border: `1px solid ${gc.color}40`,
              boxShadow: `0 0 12px ${gc.glow}, 0 0 4px ${gc.color}30`,
            }}
          >
            <QRCodeSVG
              value={recordingUrl}
              size={128}
              bgColor="transparent"
              fgColor="#ffffff"
              level="M"
            />
          </div>
          <span
            className="text-[9px] tracking-[0.3em] uppercase"
            style={{
              fontFamily: "var(--font-audiowide)",
              color: `${gc.color}99`,
            }}
          >
            Scan to download your performance
          </span>
        </div>
      ) : (
        <div
          className={`mt-8 flex flex-col items-center gap-2 ${active ? "report-stat-pop" : ""}`}
          style={{ animationDelay: "0.8s" }}
        >
          <div className="w-[128px] h-[128px] flex items-center justify-center rounded-lg"
            style={{
              background: "rgba(0, 0, 0, 0.6)",
              border: `1px solid ${gc.color}40`,
            }}
          >
            <div
              className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: `${gc.color} transparent ${gc.color} ${gc.color}` }}
            />
          </div>
          <span
            className="text-[9px] tracking-[0.3em] uppercase"
            style={{
              fontFamily: "var(--font-audiowide)",
              color: `${gc.color}99`,
            }}
          >
            {recordingUploading ? "Uploading recording..." : "Preparing recording..."}
          </span>
        </div>
      )}

      {/* CTA button */}
      <button
        className={`mt-6 px-10 py-3.5 rounded text-base tracking-[0.2em] uppercase ${isGym ? "report-btn-gym" : "neon-btn"}`}
        style={{ fontFamily: "var(--font-audiowide)" }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        {isGym ? "Train Again" : "Dance Again"}
      </button>
    </div>
  );
}
