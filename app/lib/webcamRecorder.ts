let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let resolveStop: ((blob: Blob) => void) | null = null;

export function startWebcamRecording(stream: MediaStream): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    return; // Already recording
  }

  chunks = [];

  // Prefer VP8/WebM, fall back to whatever the browser supports
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
    ? "video/webm;codecs=vp8"
    : "video/webm";

  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    chunks = [];
    if (resolveStop) {
      resolveStop(blob);
      resolveStop = null;
    }
  };

  mediaRecorder.start(1000); // Collect data every 1s
}

export function stopWebcamRecording(): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      resolve(null);
      return;
    }
    resolveStop = resolve;
    mediaRecorder.stop();
  });
}

export function isWebcamRecording(): boolean {
  return mediaRecorder !== null && mediaRecorder.state === "recording";
}
