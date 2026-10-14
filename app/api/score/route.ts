import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY not configured" },
      { status: 501 }
    );
  }

  try {
    const { referenceFrame, webcamFrame } = await req.json();

    if (!referenceFrame || !webcamFrame) {
      return NextResponse.json(
        { error: "Missing referenceFrame or webcamFrame" },
        { status: 400 }
      );
    }

    const groq = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these two poses:" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${referenceFrame}`,
              },
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${webcamFrame}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 150,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse model response", raw },
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
    });
  } catch (err) {
    console.error("Groq score API error:", err);
    return NextResponse.json(
      { error: "Groq API call failed" },
      { status: 502 }
    );
  }
}
