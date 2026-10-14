/**
 * Classifies a YouTube video as "dance" or "gym" based on its title and description.
 * Uses Groq API with a fast text model for classification.
 */

import type { AppMode } from "../shared/mode";
import OpenAI from "openai";

export async function classifyVideo(
  title: string,
  description: string
): Promise<AppMode> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return "dance";

  try {
    const groq = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "Given a YouTube video title and description, classify it as either 'fitness' or 'dance'. Reply with ONLY the word 'fitness' or 'dance'.",
        },
        {
          role: "user",
          content: `Title: ${title}\n\nDescription: ${(description || "").slice(0, 1000)}`,
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const raw = (completion.choices[0]?.message?.content ?? "")
      .trim()
      .toLowerCase();

    if (raw.includes("fitness")) return "gym";
    if (raw.includes("dance")) return "dance";
    return "dance";
  } catch (err) {
    console.error("classifyVideo error:", err);
    return "dance";
  }
}
