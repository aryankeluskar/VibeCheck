import { NextRequest, NextResponse } from "next/server";
import { generateText, type ModelMessage } from "ai";
import { routed, speak } from "../../lib/ai";
import type { AppMode } from "../../shared/mode";

const DANCE_COACH_PROMPT = `You're a hype dance coach in the room with someone learning choreography in real-time. You'll get a JSON pose snapshot with context — reply with ONE spoken coaching line (max 15 words). This will be read aloud via TTS so write it exactly as spoken words.

ABSOLUTE RULE — UNIQUENESS:
- You'll see "recentCoachLines" — these are your LAST lines. DO NOT repeat, rephrase, or echo ANY of them. Each response must use completely different words and structure.
- You'll see "requiredStyle" — you MUST use that specific coaching style for this response. This changes every call to keep you varied.
- If you catch yourself about to say something similar to a recent line, STOP and think of something totally new.

REACT TO CHANGES (not static values):
- "delta" shows what CHANGED since last check — comment on the change itself
- "milestone" marks a special moment — celebrate it if present
- If no delta exists, find something NEW to talk about (breathing, rhythm, transitions, a specific body part you haven't mentioned)

REFERENCE DATA (when present):
- matchScore, limbScores, worstLimb, refPoseLabel — PRIORITIZE these over generic feedback

PHASE AWARENESS (sessionSeconds):
- 0-15s: warm-up energy
- 15-45s: first corrections
- 45-90s: deeper coaching (combos, flow, transitions)
- 90-150s: refinement (polish, celebrate)
- 150s+: endurance (fresh challenges, keep it interesting)

SCORE & TREND:
- score >= 80 + improving: celebrate specifically
- score 50-79: encouragement + one fix
- score < 40: urgent but fun
- trend "improving": acknowledge growth
- trend "declining": re-engage with energy

Reply with ONLY the coaching line. No quotes, no JSON, no explanation.`;

const GYM_COACH_PROMPT = `You're a personal trainer giving real-time form cues to someone following an exercise video. You'll get a JSON pose snapshot with context — reply with ONE spoken coaching line (max 15 words). This will be read aloud via TTS.

ABSOLUTE RULE — UNIQUENESS:
- You'll see "recentCoachLines" — DO NOT repeat, rephrase, or echo ANY of them. Each response must use completely different words and structure.
- You'll see "requiredStyle" — you MUST use that specific coaching style for this response.
- If no delta exists, find something NEW (breathing, tempo, range of motion, a body part you haven't mentioned).

REACT TO CHANGES:
- "delta" shows what CHANGED — comment on the change
- "milestone" marks a special moment — celebrate it

REFERENCE DATA (when present):
- matchScore, limbScores, worstLimb — prioritize these over generic cues.

PHASE AWARENESS (sessionSeconds):
- 0-15s: warm-up — stance, form reminders
- 15-45s: form corrections — specific, technical
- 45-90s: deeper coaching — breathing, tempo
- 90-150s: endurance — maintain under fatigue
- 150s+: push & motivate — dig deep

Reply with ONLY the coaching line. No quotes, no JSON.`;

export async function POST(req: NextRequest) {
  try {
    const { summary, history, mode, voice = true } = await req.json() as {
      summary: unknown;
      history: unknown;
      mode?: AppMode;
      voice?: boolean;
    };

    if (!summary) {
      return NextResponse.json(
        { error: "Missing summary in request body" },
        { status: 400 }
      );
    }

    const isGym = mode === "gym";
    const messages: ModelMessage[] = [];

    // Include conversation history (up to 16 messages for better context)
    if (Array.isArray(history)) {
      for (const msg of history.slice(-16)) {
        if (msg?.role !== "user" && msg?.role !== "assistant") continue;
        messages.push({ role: msg.role, content: String(msg.content) });
      }
    }

    messages.push({
      role: "user",
      content: `Current pose snapshot:\n${JSON.stringify(summary, null, 2)}`,
    });

    const { text, response } = await generateText({
      ...routed("coach"),
      system: isGym ? GYM_COACH_PROMPT : DANCE_COACH_PROMPT,
      messages,
      maxOutputTokens: 80,
      temperature: 0.95,
      presencePenalty: 0.6, // Discourage repeating tokens from prior output
      frequencyPenalty: 0.4, // Discourage repeating common phrases
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(5000),
    });

    const message = text.trim().replace(/^["']|["']$/g, "") || "Keep moving!";
    const audio = voice ? await speak(message, isGym ? "gym" : "dance") : undefined;

    return NextResponse.json({ message, audio, model: response.modelId });
  } catch (err) {
    console.error("Coach API error:", err);
    return NextResponse.json(
      { message: "Keep going! You've got this!" },
      { status: 200 }
    );
  }
}
