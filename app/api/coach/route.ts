import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { message: "Set OPENAI_API_KEY in .env.local to enable AI coach!" },
        { status: 200 }
      );
    }

    const { summary, history, mode } = await req.json() as {
      summary: unknown;
      history: unknown;
      mode?: AppMode;
    };

    if (!summary) {
      return NextResponse.json(
        { error: "Missing summary in request body" },
        { status: 400 }
      );
    }

    const isGym = mode === "gym";
    const systemPrompt = isGym ? GYM_COACH_PROMPT : DANCE_COACH_PROMPT;

    const openai = new OpenAI({ apiKey });

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    // Include conversation history (up to 16 messages for better context)
    if (Array.isArray(history)) {
      for (const msg of history.slice(-16)) {
        messages.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({
      role: "user",
      content: `Current pose snapshot:\n${JSON.stringify(summary, null, 2)}`,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 80,
      temperature: 0.95,
      presence_penalty: 0.6,  // Discourage repeating tokens from prior output
      frequency_penalty: 0.4, // Discourage repeating common phrases
    });

    const message =
      completion.choices[0]?.message?.content?.trim() ?? "Keep moving!";

    // Generate speech audio via ElevenLabs TTS
    let audio: string | undefined;
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (elevenLabsKey) {
      try {
        // Voice IDs — pick energetic voices suited to coaching
        // Dance: "Rachel" (21m00Tcm4TlvDq8ikWAM) — bright & expressive
        // Gym:   "Adam"   (pNInz6obpgDQGcFmaJgB) — deep & authoritative
        const voiceId = isGym
          ? "pNInz6obpgDQGcFmaJgB"
          : "21m00Tcm4TlvDq8ikWAM";

        const ttsRes = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": elevenLabsKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text: message,
              model_id: "eleven_turbo_v2_5",
              voice_settings: {
                stability: 0.4,
                similarity_boost: 0.75,
                style: 0.6,
                use_speaker_boost: true,
              },
            }),
          }
        );

        if (ttsRes.ok) {
          const buf = Buffer.from(await ttsRes.arrayBuffer());
          audio = buf.toString("base64");
        } else {
          console.error("ElevenLabs TTS error:", ttsRes.status, await ttsRes.text());
        }
      } catch (ttsErr) {
        console.error("ElevenLabs TTS error (falling back to text only):", ttsErr);
      }
    } else {
      // Fallback to OpenAI TTS if no ElevenLabs key
      try {
        const ttsRes = await openai.audio.speech.create({
          model: "tts-1-hd",
          voice: isGym ? "onyx" : "shimmer",
          input: message,
          response_format: "mp3",
          speed: 1.15,
        });
        const buf = Buffer.from(await ttsRes.arrayBuffer());
        audio = buf.toString("base64");
      } catch (ttsErr) {
        console.error("OpenAI TTS fallback error:", ttsErr);
      }
    }

    return NextResponse.json({ message, audio });
  } catch (err) {
    console.error("Coach API error:", err);
    return NextResponse.json(
      { message: "Keep going! You've got this!" },
      { status: 200 }
    );
  }
}
