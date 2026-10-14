/**
 * Classifies a YouTube video as "dance" or "gym" based on its title and description.
 * Uses a small, fast text model through AI Gateway.
 */

import type { AppMode } from "../shared/mode";
import { generateText } from "ai";
import { routed } from "./ai";

export async function classifyVideo(
  title: string,
  description: string
): Promise<AppMode> {
  try {
    const { text } = await generateText({
      ...routed("classify"),
      system:
        "Given a YouTube video title and description, classify it as either 'fitness' or 'dance'. Reply with ONLY the word 'fitness' or 'dance'.",
      prompt: `Title: ${title}\n\nDescription: ${(description || "").slice(0, 1000)}`,
      maxOutputTokens: 10,
      temperature: 0,
      abortSignal: AbortSignal.timeout(5000),
    });

    const raw = text
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
