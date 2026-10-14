import { NextRequest } from "next/server";
import { mkdir } from "fs/promises";
import path from "path";
// BrightData client kept in codebase at ../../lib/brightdata.ts but not used here
import { generateVideo, waitForVideo, downloadVideo } from "../../lib/grok";
import OpenAI from "openai";

const VIDEO_DIR = "/tmp/jigglewiggle";

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Classify the prompt as dance or gym. */
function classifyPrompt(prompt: string): "dance" | "gym" {
  const lower = prompt.toLowerCase();
  const danceKeywords = ["dance", "choreography", "choreo", "moves", "groove", "hip hop", "ballet", "salsa", "tango"];
  const gymKeywords = ["workout", "exercise", "fitness", "muscle", "reps", "sets", "hiit", "core", "abs", "leg", "arm", "chest", "back", "squat", "push", "pull", "cardio", "yoga", "stretch", "warm up", "cool down"];

  const danceScore = danceKeywords.filter((k) => lower.includes(k)).length;
  const gymScore = gymKeywords.filter((k) => lower.includes(k)).length;

  return danceScore > gymScore ? "dance" : "gym";
}

export async function POST(request: NextRequest) {
  const { prompt } = (await request.json()) as { prompt: string };

  if (!prompt || prompt.trim().length < 3) {
    return new Response(
      JSON.stringify({ error: "Prompt too short" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  await mkdir(VIDEO_DIR, { recursive: true });

  const genId = `gen_${Date.now()}`;
  const outputPath = path.join(VIDEO_DIR, `${genId}.mp4`);
  const mode = classifyPrompt(prompt);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (data: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(sse(data)));
      };
      const close = () => {
        if (!closed) { closed = true; controller.close(); }
      };

      try {
        // Emit the generated video ID so the client knows what to request
        emit({ type: "genId", id: genId });
        emit({ type: "classified", mode, title: prompt });

        // Phase 1: Research via Perplexity Sonar (web-grounded)
        emit({ type: "progress", percent: 5, phase: "researching" });

        const perplexity = new OpenAI({
          apiKey: process.env.PERPLEXITY_API_KEY,
          baseURL: "https://api.perplexity.ai",
        });

        let researchData = "";
        try {
          const researchCompletion = await perplexity.chat.completions.create({
            model: "sonar-pro",
            messages: [
              {
                role: "system",
                content: "You are a fitness research assistant. Provide detailed, actionable exercise information with specific movements, form cues, timing, and step-by-step instructions. Cite real sources.",
              },
              {
                role: "user",
                content: `Find detailed exercise routines, step-by-step instructions, and movement descriptions for: ${prompt}. Include specific exercises, form cues, muscle groups targeted, and timing for each movement.`,
              },
            ],
          });
          researchData = researchCompletion.choices[0]?.message?.content?.trim() || "";
        } catch (err) {
          console.error("Perplexity research failed, continuing with prompt only:", err);
        }

        emit({ type: "progress", percent: 30, phase: "researching" });

        // Phase 2: Synthesize into video description with GPT
        emit({ type: "progress", percent: 40, phase: "synthesizing" });

        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const synthesisPrompt = `You are a fitness and movement expert. Based on the user's request and the research below, create a detailed visual description for a single 10-second video clip.

USER REQUEST: "${prompt}"

${researchData ? `RESEARCH FROM THE INTERNET:\n${researchData}` : "No external research available - use your expertise."}

Create a vivid, detailed description of a single continuous video showing a person performing the exercise/movement. STRICT REQUIREMENTS:
- STATIC CAMERA: The camera must be completely stationary and fixed in place. No panning, zooming, tracking, or camera movement of any kind. Use a locked-off front-facing medium shot.
- PLAIN BACKGROUND: The setting must be a clean white studio or a plain white/light gray wall. No gym equipment, no windows, no decorations — just a minimal, distraction-free background.
- Show the full body of the person from head to toe, centered in frame.
- The person performs the movements with clear, deliberate form.

Keep the description under 200 words. The video will be 15 seconds long. Be specific and visual — this will be used to generate a video.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: synthesisPrompt }],
          max_tokens: 300,
          temperature: 0.7,
        });

        const videoDescription =
          completion.choices[0]?.message?.content?.trim() ||
          `A person performing ${prompt} in a clean white studio with a plain white background, static locked-off camera, full body visible head to toe, demonstrating proper form with clear slow movements.`;

        emit({ type: "progress", percent: 50, phase: "synthesizing" });
        emit({ type: "synthesis", description: videoDescription });

        // Phase 3: Generate video with Grok
        emit({ type: "progress", percent: 55, phase: "generating" });

        const requestId = await generateVideo(videoDescription, {
          duration: 10,
          aspect_ratio: "4:3",
          resolution: "480p",
        });

        emit({ type: "progress", percent: 60, phase: "generating" });

        // Poll for completion
        const videoUrl = await waitForVideo(requestId, () => {
          emit({ type: "progress", percent: 70, phase: "generating" });
        });

        emit({ type: "progress", percent: 85, phase: "downloading" });

        // Phase 4: Download to local
        await downloadVideo(videoUrl, outputPath);

        emit({ type: "progress", percent: 100, phase: "done" });
        emit({ type: "done" });
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Generation failed",
        });
      }

      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
