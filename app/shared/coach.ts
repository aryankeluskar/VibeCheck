/**
 * LLM-powered coach with strong conversational variety.
 * SHARED MODULE — used by both the YouTube app and the Zoom app.
 *
 * Anti-repetition features:
 * - Sends last 10 coach lines as a "DO NOT SAY" list
 * - Fuzzy duplicate detection (Jaccard similarity on words)
 * - Rotating "coaching style" hint so the LLM switches approach each time
 * - Delta tracking (what changed since last call)
 * - Milestone moments
 * - Presence/frequency penalties on the API side
 * - Strips noisy raw data from history to reduce stale-context parroting
 */

import type { PoseSummary } from "./scoring";
import type { AppMode } from "./mode";
import { isSpeechPlaying } from "./speech";

type ChatMessage = { role: "user" | "assistant"; content: string };
const conversationHistory: ChatMessage[] = [];
const MAX_HISTORY = 16;

// Recent coach lines for anti-repeat
const recentCoachLines: string[] = [];
const MAX_RECENT_LINES = 10;

let lastRequestTs = 0;
let pendingRequest = false;
let lastMessage = "";
let lastMessageSessionSeconds = 0;
let lastSummaryScore = 50;
let lastSummaryTrend: "improving" | "declining" | "steady" = "steady";

// Delta tracking
let prevScore = 50;
let prevWorstLimb = "";
let prevMotionEnergy = 0;
let prevArmHeight = 0;

// Milestone tracking
let peakScore = 0;
let hitMilestones = new Set<string>();
let coachCallCount = 0;

// Style rotation — forces the LLM to use a different style each call
const COACHING_STYLES = [
  "Ask a question about their form",
  "Give a direct command",
  "React with excitement or surprise",
  "Use a count or rhythm cue",
  "Challenge them to hit a target",
  "Use a metaphor or analogy",
  "Be playfully funny",
  "Pure hype energy",
  "Give a very specific technical cue",
  "Comment on their progress over time",
  "Reference the music or beat",
  "Encourage them like a friend",
] as const;
let styleIndex = 0;

export type CoachResult = { message: string; audio?: string };

function getAdaptiveInterval(): number {
  if (lastSummaryTrend === "declining" || lastSummaryScore < 40) return 3500;
  if (lastSummaryScore >= 80) return 5500;
  return 4500;
}

// ─── Fuzzy duplicate detection ───────────────────────────────

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function isTooSimilar(newMsg: string, existingLines: string[]): boolean {
  const newTokens = tokenize(newMsg);
  for (const line of existingLines) {
    if (jaccardSimilarity(newTokens, tokenize(line)) > 0.6) return true;
  }
  return false;
}

// ─── Delta tracking ──────────────────────────────────────────

function buildDelta(summary: PoseSummary): Record<string, string> {
  const delta: Record<string, string> = {};
  const scoreDiff = summary.score - prevScore;
  if (Math.abs(scoreDiff) >= 3) {
    delta.score = `${scoreDiff > 0 ? "+" : ""}${scoreDiff} (was ${prevScore}, now ${summary.score})`;
  }

  const ref = summary.reference;
  if (ref && ref.worstLimb !== prevWorstLimb && prevWorstLimb) {
    delta.worstLimb = `changed from ${prevWorstLimb} to ${ref.worstLimb}`;
  }

  if (summary.body) {
    const energyDiff = summary.body.motionEnergy - prevMotionEnergy;
    if (Math.abs(energyDiff) > 0.02) {
      delta.energy = energyDiff > 0 ? "moving more" : "moving less";
    }
    const armDiff = summary.body.armHeight - prevArmHeight;
    if (Math.abs(armDiff) > 0.05) {
      delta.armHeight = armDiff < 0 ? "arms higher" : "arms lower";
    }
  }

  prevScore = summary.score;
  prevMotionEnergy = summary.body?.motionEnergy ?? 0;
  prevArmHeight = summary.body?.armHeight ?? 0;
  if (ref) prevWorstLimb = ref.worstLimb;

  return delta;
}

// ─── Milestone tracking ──────────────────────────────────────

function checkMilestones(summary: PoseSummary): string | null {
  const milestones: string[] = [];

  if (summary.score > peakScore && summary.score >= 60) {
    peakScore = summary.score;
    const bucket = Math.floor(summary.score / 10) * 10;
    if (!hitMilestones.has("peak_" + bucket)) {
      hitMilestones.add("peak_" + bucket);
      milestones.push(`New personal best: ${summary.score}!`);
    }
  }

  if (summary.score >= 80 && !hitMilestones.has("hit80")) {
    hitMilestones.add("hit80");
    milestones.push("First time hitting 80+!");
  }
  if (summary.score >= 90 && !hitMilestones.has("hit90")) {
    hitMilestones.add("hit90");
    milestones.push("First time hitting 90+!");
  }

  if (prevScore < 40 && summary.score >= 70 && !hitMilestones.has("comeback")) {
    hitMilestones.add("comeback");
    milestones.push("Amazing comeback from a rough patch!");
  }

  const mins = Math.floor(summary.sessionSeconds / 60);
  if (mins >= 1 && !hitMilestones.has("1min")) {
    hitMilestones.add("1min");
    milestones.push("One minute in, still going!");
  }
  if (mins >= 3 && !hitMilestones.has("3min")) {
    hitMilestones.add("3min");
    milestones.push("Three minutes of practice!");
  }
  if (mins >= 5 && !hitMilestones.has("5min")) {
    hitMilestones.add("5min");
    milestones.push("Five minutes strong!");
  }

  if (summary.score >= 80 && summary.trend === "steady" && coachCallCount > 5 && !hitMilestones.has("sustained80")) {
    hitMilestones.add("sustained80");
    milestones.push("Holding 80+ consistently — that's skill!");
  }

  return milestones.length > 0 ? milestones[0] : null;
}

// ─── Compact summary for history ─────────────────────────────
// Instead of dumping the full JSON into history (which makes all entries
// look similar and encourages repetitive responses), store a short
// human-readable sentence.

function compactSummary(summary: PoseSummary, delta: Record<string, string>): string {
  const parts: string[] = [];
  parts.push(`Score ${summary.score} (${summary.trend})`);

  if (summary.reference) {
    parts.push(`match ${summary.reference.matchScore}, worst: ${summary.reference.worstLimb}`);
  }

  const deltaEntries = Object.entries(delta);
  if (deltaEntries.length > 0) {
    parts.push("Changes: " + deltaEntries.map(([k, v]) => `${k}=${v}`).join(", "));
  }

  parts.push(`${summary.sessionSeconds}s in`);
  return parts.join(" | ");
}

// ─── Main API ────────────────────────────────────────────────

export async function getCoachMessage(
  summary: PoseSummary,
  mode: AppMode = "dance"
): Promise<CoachResult | null> {
  const now = Date.now();

  lastSummaryScore = summary.score;
  lastSummaryTrend = summary.trend;

  const interval = getAdaptiveInterval();
  if (now - lastRequestTs < interval) return null;
  if (pendingRequest) return null;
  if (isSpeechPlaying()) return null;
  if (summary.score === 0 && lastMessage.includes("no pose")) return null;

  pendingRequest = true;
  lastRequestTs = now;
  coachCallCount++;

  const delta = buildDelta(summary);
  const milestone = checkMilestones(summary);

  // Pick next coaching style (rotate)
  const currentStyle = COACHING_STYLES[styleIndex % COACHING_STYLES.length];
  styleIndex++;

  const enrichedSummary = {
    ...summary,
    delta: Object.keys(delta).length > 0 ? delta : undefined,
    milestone: milestone || undefined,
    recentCoachLines: recentCoachLines.length > 0 ? recentCoachLines : undefined,
    requiredStyle: currentStyle,
    coachCallNumber: coachCallCount,
  };

  try {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: enrichedSummary,
        history: conversationHistory.slice(-MAX_HISTORY),
        mode,
      }),
    });

    if (!res.ok) {
      pendingRequest = false;
      return null;
    }

    const data = await res.json();
    let message: string = data.message ?? "Keep going!";
    const audio: string | undefined = data.audio;

    // Suppress exact duplicates within 15s
    const sessionDelta = summary.sessionSeconds - lastMessageSessionSeconds;
    if (message === lastMessage && sessionDelta < 15) {
      pendingRequest = false;
      return null;
    }

    // Suppress fuzzy duplicates (too similar to recent lines)
    if (isTooSimilar(message, recentCoachLines.slice(-5))) {
      // Don't show it, but still update timestamps so we try again later
      lastRequestTs = now;
      pendingRequest = false;
      return null;
    }

    // Store compact version in history (not raw JSON)
    conversationHistory.push({
      role: "user",
      content: compactSummary(summary, delta),
    });
    conversationHistory.push({
      role: "assistant",
      content: message,
    });

    while (conversationHistory.length > MAX_HISTORY * 2) {
      conversationHistory.shift();
    }

    recentCoachLines.push(message);
    while (recentCoachLines.length > MAX_RECENT_LINES) {
      recentCoachLines.shift();
    }

    lastMessage = message;
    lastMessageSessionSeconds = summary.sessionSeconds;
    pendingRequest = false;
    return { message, audio };
  } catch (err) {
    console.error("Coach fetch error:", err);
    pendingRequest = false;
    return null;
  }
}

export function resetCoach(): void {
  conversationHistory.length = 0;
  recentCoachLines.length = 0;
  lastRequestTs = 0;
  lastMessage = "";
  lastMessageSessionSeconds = 0;
  lastSummaryScore = 50;
  lastSummaryTrend = "steady";
  pendingRequest = false;
  prevScore = 50;
  prevWorstLimb = "";
  prevMotionEnergy = 0;
  prevArmHeight = 0;
  peakScore = 0;
  hitMilestones = new Set();
  coachCallCount = 0;
  styleIndex = 0;
}

// ──────────────────────────────────────────────
// Stub hooks for sponsor integrations (future)
// ──────────────────────────────────────────────

/** TODO: Suno — overlay dynamically generated music */
export function sunoMusicOverlay(_videoId: string): void {}

/** TODO: HeyGen — selectable coach avatar overlay */
export function heyGenCoachAvatar(_style: string): void {}

/** TODO: Modal — host segmentation / pose model on Modal */
export function modalSegmentationModel(_frame: ImageData): void {}
