import type { NormalizedLandmark } from "./pose";

export type PoseRecording = {
  videoId: string;
  frames: Array<{
    /** ms elapsed since recording start */
    t: number;
    /** reference video currentTime at this moment */
    vt: number;
    /** 33 MediaPipe landmarks */
    lm: NormalizedLandmark[];
  }>;
};

// --- Module-level state ---
let recording = false;
let startTime = 0;
let currentVideoId = "";
let buffer: PoseRecording["frames"] = [];

export function startRecording(videoId: string): void {
  buffer = [];
  currentVideoId = videoId;
  startTime = Date.now();
  recording = true;
}

export function recordFrame(
  landmarks: NormalizedLandmark[],
  videoTime: number
): void {
  if (!recording) return;
  buffer.push({
    t: Date.now() - startTime,
    vt: videoTime,
    lm: landmarks,
  });
}

export function stopRecording(): PoseRecording {
  recording = false;
  const result: PoseRecording = {
    videoId: currentVideoId,
    frames: buffer,
  };
  buffer = [];
  return result;
}

export function isRecording(): boolean {
  return recording;
}

export function downloadRecording(rec: PoseRecording): void {
  const json = JSON.stringify(rec);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `poses-${rec.videoId}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadRecording(file: File): Promise<PoseRecording> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as PoseRecording;
        if (!parsed.videoId || !Array.isArray(parsed.frames)) {
          reject(new Error("Invalid recording format"));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
