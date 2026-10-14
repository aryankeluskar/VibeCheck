/**
 * OpenAI TTS audio playback for the dance coach.
 * SHARED MODULE — used by both the YouTube app and the Zoom app.
 */

let isSpeaking = false;
let muted = false;
let currentAudio: HTMLAudioElement | null = null;

// Ducking: while the coach talks, fade a registered media element (the
// reference video's music) down so the voice is clear, then back up.
// Opt-in via setDuckTarget; callers that never register one are unaffected.
const DUCK_LEVEL = 0.25;
const FADE_MS = 180;
let duckTarget: HTMLMediaElement | null = null;
let duckRestore: number | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;

function fadeTo(el: HTMLMediaElement, to: number): void {
  if (fadeTimer) clearInterval(fadeTimer);
  // setInterval, not requestAnimationFrame: window rAF stops during WebXR sessions.
  const from = el.volume;
  const steps = 6;
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    el.volume = Math.min(1, Math.max(0, from + ((to - from) * i) / steps));
    if (i >= steps && fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }, FADE_MS / steps);
}

function duck(): void {
  if (!duckTarget || duckRestore !== null) return;
  duckRestore = duckTarget.volume;
  fadeTo(duckTarget, Math.min(duckRestore, DUCK_LEVEL));
}

function unduck(): void {
  if (!duckTarget || duckRestore === null) return;
  fadeTo(duckTarget, duckRestore);
  duckRestore = null;
}

/** Register the element whose audio should dip while the coach speaks (null to clear). */
export function setDuckTarget(el: HTMLMediaElement | null): void {
  if (el === duckTarget) return;
  if (duckTarget && duckRestore !== null) {
    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = null;
    duckTarget.volume = duckRestore;
  }
  duckRestore = null;
  duckTarget = el;
  if (el && isSpeaking) duck();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (value) cancelSpeech();
}

// One reusable element, played once inside a click by unlockSpeech(). Some
// browsers only let an element play outside a gesture if it was first played
// inside one, so a fresh `new Audio()` per coach line can stay silent in XR.
let sharedAudio: HTMLAudioElement | null = null;
let speechSeq = 0;
let currentUrl: string | null = null;
const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Call synchronously inside a click (e.g. Enter) so later coach lines can play. */
export function unlockSpeech(): void {
  if (typeof window === "undefined") return;
  sharedAudio ??= new Audio();
  if (isSpeaking) return;
  sharedAudio.src = SILENT_WAV;
  sharedAudio.play().catch(() => {});
}

function release(): void {
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  currentAudio = null;
  isSpeaking = false;
  unduck();
}

export function speak(audioBase64: string): void {
  if (typeof window === "undefined") return;
  if (isSpeaking || muted) return;

  const blob = new Blob(
    [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
    { type: "audio/mpeg" }
  );
  const url = URL.createObjectURL(blob);
  const audio = sharedAudio ?? new Audio();
  audio.src = url;

  const token = ++speechSeq;
  isSpeaking = true;
  currentAudio = audio;
  currentUrl = url;
  duck();

  // Ignore events from a clip that was cancelled or replaced.
  const done = () => {
    if (token === speechSeq) release();
  };
  audio.onended = done;
  audio.onerror = done;
  audio.play().catch(done);
}

export function isSpeechPlaying(): boolean {
  return isSpeaking;
}

export function cancelSpeech(): void {
  speechSeq++;
  currentAudio?.pause();
  release();
}
