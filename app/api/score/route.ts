import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { routed } from "../../lib/ai";

const SYSTEM_PROMPT = `You are a dance pose comparison engine. You receive two images:
1. A reference frame from a dance video
2. A live webcam frame of a dancer trying to match the reference

Compare the dancer's pose to the reference and respond with ONLY valid JSON (no markdown, no extra text):
{
  "score": <0-100 overall match>,
  "bodyMatch": <0-100 how well the overall body position matches>,
  "limbDetail": {
    "leftArm": <0-100>,
    "rightArm": <0-100>,
    "leftLeg": <0-100>,
    "rightLeg": <0-100>,
    "torso": <0-100>
  },
  "feedback": "<one short sentence about what to fix>"
}

Score guidelines:
- 90-100: Nearly identical pose
- 70-89: Good match, minor limb differences
- 50-69: Roughly right idea, some limbs off
- 30-49: Partially matching, major differences
- 0-29: Very different poses

The webcam image may be non-mirrored. Focus on the spatial pose shape, not left/right labeling.`;

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { referenceFrame, webcamFrame } = await req.json();

    if (!referenceFrame || !webcamFrame) {
      return NextResponse.json(
        { error: "Missing referenceFrame or webcamFrame" },
        { status: 400 }
      );
    }

    const { text, response } = await generateText({
      ...routed("vision"),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these two poses. Image 1 is the reference, image 2 is the dancer:" },
            { type: "image", image: referenceFrame, mediaType: "image/jpeg" },
            { type: "image", image: webcamFrame, mediaType: "image/jpeg" },
          ],
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 200,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(8000),
    });

    const parsed = parseJsonObject(text);
    if (!parsed) {
      return NextResponse.json(
        { error: "Failed to parse model response", raw: text },
        { status: 502 }
      );
    }

    const score = typeof parsed.score === "number"
      ? Math.max(0, Math.min(100, Math.round(parsed.score)))
      : 50;

    return NextResponse.json({
      score,
      bodyMatch: typeof parsed.bodyMatch === "number" ? parsed.bodyMatch : score,
      limbDetail: parsed.limbDetail ?? {},
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      model: response.modelId,
    });
  } catch (err) {
    console.error("Vision score API error:", err);
    return NextResponse.json(
      { error: "Vision scoring failed" },
      { status: 502 }
    );
  }
}
