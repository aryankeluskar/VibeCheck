import { gateway, generateSpeech } from "ai";
import type { GatewayProviderOptions } from "@ai-sdk/gateway";

/**
 * Every model call goes through Vercel AI Gateway. Each task has a primary
 * model picked for latency/cost plus ordered fallbacks the Gateway tries
 * when the primary provider errors or times out.
 */
export const MODELS = {
  // Spoken coach line every ~4s: tiny, fast, cheap. Llama 4 Scout is served
  // on low-latency inference providers through the Gateway.
  coach: ["meta/llama-4-scout", "google/gemini-3.5-flash-lite", "openai/gpt-4o-mini"],
  // Reference frame vs. webcam frame (vision) every ~3s.
  vision: ["meta/llama-4-scout", "google/gemini-3.5-flash-lite", "openai/gpt-4o-mini"],
  // One-shot end-of-session report card (quality over latency).
  report: ["meta/llama-4-maverick", "google/gemini-3.5-flash", "openai/gpt-4o-mini"],
  // Dance vs. fitness classification of a video title.
  classify: ["meta/llama-3.1-8b", "google/gemini-3.5-flash-lite"],
} as const;

export type ModelTask = keyof typeof MODELS;

/** Primary model plus Gateway-side fallback list for a task. */
export function routed(task: ModelTask) {
  const [primary, ...fallbacks] = MODELS[task];
  return {
    model: gateway(primary),
    providerOptions: {
      gateway: { models: fallbacks } satisfies GatewayProviderOptions,
    },
  };
}

type Voice = "dance" | "gym";

// Speech fallbacks are tried client-side of the Gateway (here) so a voice
// can be chosen per provider.
const SPEECH_CHAIN: { model: string; voice: Record<Voice, string> }[] = [
  { model: "openai/tts-1", voice: { dance: "shimmer", gym: "onyx" } },
  { model: "google/gemini-3.8-flash-lite-tts", voice: { dance: "Puck", gym: "Charon" } },
];

/** Text → mp3 (base64). Returns undefined if every speech model fails. */
export async function speak(text: string, voice: Voice): Promise<string | undefined> {
  for (const entry of SPEECH_CHAIN) {
    try {
      const { audio } = await generateSpeech({
        model: gateway.speechModel(entry.model),
        text,
        voice: entry.voice[voice],
        outputFormat: "mp3",
        speed: 1.1,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(6000),
      });
      return audio.base64;
    } catch (err) {
      console.error(`[tts] ${entry.model} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return undefined;
}
