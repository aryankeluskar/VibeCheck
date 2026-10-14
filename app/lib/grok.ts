import { writeFile } from "fs/promises";

const API_KEY = process.env.XAI_API_KEY;
const BASE = "https://api.x.ai/v1/videos";

interface GenerateOptions {
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}

interface VideoStatus {
  status?: "pending" | "done" | "expired";
  video?: {
    url: string;
    duration: number;
  };
  model?: string;
}

/** Submit a video generation request. Returns the request ID. */
export async function generateVideo(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const body = {
    model: "grok-imagine-video",
    prompt,
    duration: options.duration ?? 15,
    aspect_ratio: options.aspect_ratio ?? "16:9",
    resolution: options.resolution ?? "480p",
  };
  console.log("[grok] Submitting video generation:", JSON.stringify(body).slice(0, 200));

  const res = await fetch(`${BASE}/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[grok] Generation request failed:", res.status, text);
    throw new Error(`Grok video generation failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log("[grok] Got request_id:", data.request_id);
  return data.request_id;
}

/** Poll for video generation status. */
export async function pollVideoStatus(requestId: string): Promise<VideoStatus> {
  const res = await fetch(`${BASE}/${requestId}`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[grok] Poll response error:", res.status, text.slice(0, 300));
    throw new Error(`Grok status poll failed (${res.status}): ${text}`);
  }

  const raw = await res.text();
  console.log("[grok] Poll raw response:", raw.slice(0, 500));
  return JSON.parse(raw) as VideoStatus;
}

/** Poll until video is ready, calling onProgress periodically. */
export async function waitForVideo(
  requestId: string,
  onProgress?: (status: string) => void,
  maxWaitMs = 600_000
): Promise<string> {
  const start = Date.now();
  const interval = 5_000;

  let pollCount = 0;
  while (Date.now() - start < maxWaitMs) {
    pollCount++;
    const status = await pollVideoStatus(requestId);
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[grok] Poll #${pollCount} (${elapsed}s): status=${status.status}`);

    // When done, Grok may omit `status` and just return `video` directly
    if (status.video?.url) {
      console.log("[grok] Video ready:", status.video.url.slice(0, 80));
      return status.video.url;
    }

    if (status.status === "expired") {
      throw new Error("Video generation expired");
    }

    onProgress?.("pending");
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error("Video generation timed out");
}

/** Download a video from a URL to a local file path. */
export async function downloadVideo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download video (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
}
