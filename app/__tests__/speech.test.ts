import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal Audio stand-in: play() resolves, finish() fires onended.
class FakeAudio {
  static created: FakeAudio[] = [];
  src = "";
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src?: string) {
    if (src) this.src = src;
    FakeAudio.created.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  finish() {
    this.paused = true;
    this.onended?.();
  }
}

const CLIP = btoa("not really an mp3");
type Speech = typeof import("../shared/speech");

async function load(): Promise<Speech> {
  vi.resetModules();
  return import("../shared/speech");
}

describe("speech ducking and playback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudio.created = [];
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("Audio", FakeAudio);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dips the registered element while the coach speaks, then restores it", async () => {
    const s = await load();
    const music = { volume: 1 } as HTMLMediaElement;
    s.setDuckTarget(music);
    s.speak(CLIP);
    vi.advanceTimersByTime(500);
    expect(music.volume).toBeCloseTo(0.25);
    FakeAudio.created.at(-1)!.finish();
    vi.advanceTimersByTime(500);
    expect(music.volume).toBeCloseTo(1);
    expect(s.isSpeechPlaying()).toBe(false);
  });

  it("does not ratchet the volume down when a line starts mid fade-up", async () => {
    const s = await load();
    const music = { volume: 0.8 } as HTMLMediaElement;
    s.setDuckTarget(music);
    for (let i = 0; i < 5; i++) {
      s.speak(CLIP);
      vi.advanceTimersByTime(500);
      FakeAudio.created.at(-1)!.finish();
      vi.advanceTimersByTime(60); // next line arrives before the fade-up ends
    }
    vi.advanceTimersByTime(500);
    expect(music.volume).toBeCloseTo(0.8);
  });

  it("ignores a cancelled clip's late events", async () => {
    const s = await load();
    s.speak(CLIP);
    const first = FakeAudio.created.at(-1)!;
    s.cancelSpeech();
    s.speak(CLIP);
    expect(s.isSpeechPlaying()).toBe(true);
    first.onended?.(); // stale event from the cancelled clip
    expect(s.isSpeechPlaying()).toBe(true);
  });

  it("keeps the 2D default: a fresh element per line and no volume changes", async () => {
    const s = await load();
    s.speak(CLIP);
    FakeAudio.created.at(-1)!.finish();
    s.speak(CLIP);
    expect(FakeAudio.created.length).toBe(2);
  });

  it("reuses the element unlocked by unlockSpeech()", async () => {
    const s = await load();
    s.unlockSpeech();
    const shared = FakeAudio.created.at(-1)!;
    s.speak(CLIP);
    shared.finish();
    s.speak(CLIP);
    expect(FakeAudio.created.length).toBe(1);
    expect(shared.src.startsWith("blob:")).toBe(true);
  });
});
