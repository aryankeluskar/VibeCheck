import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the video classification logic.
 *
 * classifyVideo asks a small text model (through AI Gateway) whether a video
 * is "dance" or "gym" based on its title and description.
 */

const mockGenerateText = vi.fn();

// Mock the AI SDK call so unit tests never reach AI Gateway.
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// Need to import after mock setup
import { classifyVideo } from "../lib/classifyVideo";

function mockModelResponse(text: string) {
  mockGenerateText.mockResolvedValueOnce({ text });
}

describe("classifyVideo", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  describe("unit tests with mocked metadata", () => {
    it("classifies a dance video correctly", async () => {
      mockModelResponse("dance");
      const result = await classifyVideo(
        "Learn This Viral TikTok Dance",
        "Step-by-step tutorial for the trending dance move"
      );
      expect(result).toBe("dance");
    });

    it("classifies a gym/fitness video correctly", async () => {
      mockModelResponse("fitness");
      const result = await classifyVideo(
        "10 Min Ab Workout - No Equipment",
        "Quick and effective ab workout you can do anywhere"
      );
      expect(result).toBe("gym");
    });

    it("handles 'fitness' response and maps to 'gym'", async () => {
      mockModelResponse("Fitness");
      const result = await classifyVideo(
        "Full Body HIIT Workout",
        "High intensity interval training for fat burn"
      );
      expect(result).toBe("gym");
    });

    it("handles edge case: Zumba (could be either)", async () => {
      mockModelResponse("dance");
      const result = await classifyVideo(
        "Zumba Fitness Dance Workout",
        "Fun dance workout to lose weight"
      );
      expect(["dance", "gym"]).toContain(result);
    });

    it("defaults to 'dance' on ambiguous response", async () => {
      mockModelResponse("something unexpected");
      const result = await classifyVideo(
        "Random Video Title",
        "Some description"
      );
      expect(result).toBe("dance");
    });
  });

  describe("fallback behavior", () => {
    it("returns 'dance' when the model returns nothing", async () => {
      const result = await classifyVideo(
        "10 Min Ab Workout",
        "Workout description"
      );
      expect(result).toBe("dance");
    });

    it("returns 'dance' when API call throws an error", async () => {
      mockGenerateText.mockRejectedValueOnce(new Error("API error"));
      const result = await classifyVideo(
        "Some Video",
        "Some description"
      );
      expect(result).toBe("dance");
    });
  });

  describe("integration tests (require yt-dlp + GROQ_API_KEY)", () => {
    // These tests call real external services — skip in CI
    const hasGroqKey = !!process.env.GROQ_API_KEY_REAL;
    const itIntegration = hasGroqKey ? it : it.skip;

    async function getVideoMetadata(videoId: string): Promise<{ title: string; description: string }> {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const { stdout } = await execFileAsync("yt-dlp", ["--dump-json", "--no-download", url], {
        maxBuffer: 10 * 1024 * 1024,
      });
      const meta = JSON.parse(stdout);
      return { title: meta.title ?? "", description: meta.description ?? "" };
    }

    itIntegration("classifies dance short (mWQGrkm86Ps) as dance", async () => {
      mockGenerateText.mockRestore?.();
      const { classifyVideo: realClassify } = await import("../lib/classifyVideo");
      vi.stubEnv("GROQ_API_KEY", process.env.GROQ_API_KEY_REAL!);

      const meta = await getVideoMetadata("mWQGrkm86Ps");
      const result = await realClassify(meta.title, meta.description);
      expect(result).toBe("dance");
    });

    itIntegration("classifies gym short (acj52MXBaeo) as gym", async () => {
      mockGenerateText.mockRestore?.();
      const { classifyVideo: realClassify } = await import("../lib/classifyVideo");
      vi.stubEnv("GROQ_API_KEY", process.env.GROQ_API_KEY_REAL!);

      const meta = await getVideoMetadata("acj52MXBaeo");
      const result = await realClassify(meta.title, meta.description);
      expect(result).toBe("gym");
    });
  });
});
