/**
 * OpenAI TTS audio playback for the dance coach.
 * SHARED MODULE — used by both the YouTube app and the Zoom app.
 */

let isSpeaking = false;
let muted = false;
let currentAudio: HTMLAudioElement | null = null;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (value) cancelSpeech();
}

export function speak(audioBase64: string): void {
  if (typeof window === "undefined") return;
  if (isSpeaking || muted) return;

  const blob = new Blob(
    [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
    { type: "audio/mpeg" }
  );
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  isSpeaking = true;
  currentAudio = audio;

  audio.onended = () => {
    isSpeaking = false;
    currentAudio = null;
    URL.revokeObjectURL(url);
  };
  audio.onerror = () => {
    isSpeaking = false;
    currentAudio = null;
    URL.revokeObjectURL(url);
  };

  audio.play().catch(() => {
    isSpeaking = false;
    currentAudio = null;
    URL.revokeObjectURL(url);
  });
}

export function isSpeechPlaying(): boolean {
  return isSpeaking;
}

export function cancelSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  isSpeaking = false;
}
