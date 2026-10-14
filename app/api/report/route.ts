import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { AppMode } from "../../shared/mode";

type SessionStats = {
  scoreTimeline: number[];
  limbTotals: Record<string, { sum: number; count: number }>;
  frameHits: Record<string, number>;
  peakScore: number;
  totalFrames: number;
  sessionDurationMs: number;
};

export type AIReport = {
  grade: "S" | "A" | "B" | "C" | "D";
  headline: string;
  persona: string;
  personaDesc: string;
  summary: string;
  tips: string[];
  bestLimb: string;
  worstLimb: string;
};

function computeGrade(avg: number): AIReport["grade"] {
  if (avg >= 78) return "S";
  if (avg >= 62) return "A";
  if (avg >= 45) return "B";
  if (avg >= 30) return "C";
  return "D";
}

function computeAvgScore(timeline: number[]): number {
  if (timeline.length === 0) return 0;
  return timeline.reduce((a, b) => a + b, 0) / timeline.length;
}

function computeLimbAverages(
  limbTotals: Record<string, { sum: number; count: number }>,
): Record<string, number> {
  const avgs: Record<string, number> = {};
  for (const [limb, { sum, count }] of Object.entries(limbTotals)) {
    avgs[limb] = count > 0 ? Math.round(sum / count) : 0;
  }
  return avgs;
}

const DANCE_SYSTEM_PROMPT = `You are a post-performance report card generator for a dance coaching app. You'll receive session stats and must return a JSON object with personality-driven text.

RETURN ONLY valid JSON with these fields:
{
  "headline": "string — punchy 2-5 word headline like a Spotify Wrapped card",
  "persona": "string — a fun archetype name, e.g. 'The Firecracker' or 'The Standing Ovation (For Standing Still)'",
  "personaDesc": "string — one sentence description of the persona, hype if good, roast if bad",
  "summary": "string — witty 1-2 sentence wrap-up of the performance",
  "tips": ["string — 2-3 specific improvement tips based on their weak areas"],
  "bestLimb": "string — human-readable best limb name, e.g. 'Right Arm'",
  "worstLimb": "string — human-readable worst limb name, e.g. 'Left Leg'"
}

TONE SCALES WITH GRADE:
- S/A grades: full hype, celebration, legendary status ("You didn't just dance — you ATE")
- B grade: encouraging with playful jabs ("Not bad! Your legs had ideas... different ideas, but ideas")
- C grade: witty roasts, backhanded compliments ("Your right arm was giving main character energy. The rest of you was background extra")
- D grade: full savage mode, comedic destruction ("The video was dancing. You were... present. Emotionally. Physically is debatable")

For low scores, be funny and savage — roast them like a friend would. Never mean-spirited, always comedic. Think Spotify Wrapped meets a roast battle.

LIMB NAMES: Use human-readable names: "Right Arm", "Left Arm", "Right Leg", "Left Leg", "Torso"

Return ONLY the JSON object. No markdown, no code fences, no explanation.`;

const GYM_SYSTEM_PROMPT = `You are a post-workout report card generator for a fitness form-tracking app. You'll receive session stats and must return a JSON object with personality-driven text. This is a GYM/FITNESS context — use exercise and training language, not dance language.

RETURN ONLY valid JSON with these fields:
{
  "headline": "string — punchy 2-5 word headline, gym/fitness themed (e.g. 'Iron Discipline', 'Cardboard Cutout')",
  "persona": "string — a gym archetype name, e.g. 'The Machine', 'The Warm-Up Warrior', 'The Foam Roller (You Just Laid There)'",
  "personaDesc": "string — one sentence description of the persona, motivational if good, gym-bro roast if bad",
  "summary": "string — witty 1-2 sentence wrap-up of the workout",
  "tips": ["string — 2-3 specific form improvement tips based on their weak areas, use exercise terminology"],
  "bestLimb": "string — human-readable best body part, e.g. 'Right Arm'",
  "worstLimb": "string — human-readable weakest body part, e.g. 'Left Leg'"
}

TONE SCALES WITH GRADE:
- S/A grades: peak performance hype, gym legend status ("Form so clean it made the weights jealous", "Built different. Literally.")
- B grade: solid with room to grow ("You showed up and put in work. Your legs showed up about 30 seconds late.")
- C grade: gym-bro ribbing ("Your right arm was doing CrossFit. Your left arm was doing brunch.")
- D grade: full gym fail comedy ("The equipment got more of a workout than you did. At least you burned calories walking in.")

For low scores, roast like a gym buddy would — tough love, never cruel. Think gym culture humor meets performance review.

LIMB NAMES: Use human-readable names: "Right Arm", "Left Arm", "Right Leg", "Left Leg", "Torso"

Return ONLY the JSON object. No markdown, no code fences, no explanation.`;

const LIMB_LABELS: Record<string, string> = {
  rightArm: "Right Arm",
  leftArm: "Left Arm",
  rightLeg: "Right Leg",
  leftLeg: "Left Leg",
  torso: "Torso",
};

export async function POST(req: NextRequest) {
  try {
    const { stats, mode, videoTitle } = (await req.json()) as {
      stats: SessionStats;
      mode?: AppMode;
      videoTitle?: string;
    };

    const avgScore = computeAvgScore(stats.scoreTimeline);
    const grade = computeGrade(avgScore);
    const limbAvgs = computeLimbAverages(stats.limbTotals);

    // Find best/worst limbs
    const limbEntries = Object.entries(limbAvgs);
    let bestLimb = "Torso";
    let worstLimb = "Torso";
    if (limbEntries.length > 0) {
      limbEntries.sort((a, b) => b[1] - a[1]);
      bestLimb = LIMB_LABELS[limbEntries[0][0]] ?? limbEntries[0][0];
      worstLimb =
        LIMB_LABELS[limbEntries[limbEntries.length - 1][0]] ??
        limbEntries[limbEntries.length - 1][0];
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const isGymFallback = mode === "gym";
      return NextResponse.json({
        grade,
        headline: isGymFallback
          ? (grade === "S" || grade === "A" ? "Peak Form" : grade === "B" ? "Solid Set" : grade === "C" ? "Needs Work" : "Hit the Basics")
          : (grade === "S" || grade === "A" ? "Born to Move" : grade === "B" ? "Not Bad!" : grade === "C" ? "Room to Grow" : "Keep Practicing"),
        persona: isGymFallback
          ? (grade === "D" ? "The Bench Warmer" : "The Athlete")
          : (grade === "D" ? "The Spectator" : "The Dancer"),
        personaDesc: isGymFallback
          ? (grade === "D" ? "The equipment got more of a workout." : "You showed up and put in the reps!")
          : (grade === "D" ? "You watched the video. That counts for something." : "You showed up and gave it your all!"),
        summary: `You scored an average of ${Math.round(avgScore)} across the session.`,
        tips: isGymFallback
          ? ["Focus on maintaining proper form throughout each rep", "Control the eccentric (lowering) phase", "Keep your core engaged during all movements"]
          : ["Focus on matching arm positions", "Try slowing the video down to learn the moves", "Practice the tricky sections on repeat"],
        bestLimb,
        worstLimb,
      } satisfies AIReport);
    }

    const openai = new OpenAI({ apiKey });

    const userContent = JSON.stringify({
      grade,
      avgScore: Math.round(avgScore),
      peakScore: stats.peakScore,
      limbAverages: limbAvgs,
      frameHits: stats.frameHits,
      totalFrames: stats.totalFrames,
      sessionDurationSec: Math.round(stats.sessionDurationMs / 1000),
      mode: mode ?? "dance",
      videoTitle: videoTitle ?? "Unknown",
    });

    const isGym = mode === "gym";
    const systemPrompt = isGym ? GYM_SYSTEM_PROMPT : DANCE_SYSTEM_PROMPT;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 400,
      temperature: 0.9,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If LLM returns malformed JSON, use fallback
      return NextResponse.json({
        grade,
        headline: "Performance Complete",
        persona: "The Mover",
        personaDesc: "You moved. That's what matters.",
        summary: `Average score: ${Math.round(avgScore)}. Peak: ${stats.peakScore}.`,
        tips: ["Keep practicing!", "Focus on your weaker limbs", "Try different speeds"],
        bestLimb,
        worstLimb,
      } satisfies AIReport);
    }

    const report: AIReport = {
      grade,
      headline: String(parsed.headline ?? "Performance Complete"),
      persona: String(parsed.persona ?? "The Dancer"),
      personaDesc: String(parsed.personaDesc ?? ""),
      summary: String(parsed.summary ?? ""),
      tips: Array.isArray(parsed.tips) ? parsed.tips.map(String).slice(0, 3) : [],
      bestLimb: String(parsed.bestLimb ?? bestLimb),
      worstLimb: String(parsed.worstLimb ?? worstLimb),
    };

    return NextResponse.json(report);
  } catch (err) {
    console.error("Report API error:", err);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 },
    );
  }
}
