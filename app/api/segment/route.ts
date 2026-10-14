import { NextRequest } from "next/server";
import { readFile, writeFile, access, mkdir } from "fs/promises";
import path from "path";

export const maxDuration = 600; // 10 minutes

const VIDEO_DIR = "/tmp/jigglewiggle";
const MODAL_ENDPOINT_URL = "https://aryankeluskar--jigglewiggle-sam2-sam2model-segment.modal.run";

function maskPath(videoId: string) {
  return path.join(VIDEO_DIR, `${videoId}_mask.mp4`);
}

export async function POST(request: NextRequest) {
  const { videoId } = (await request.json()) as { videoId: string };

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return Response.json({ error: "Invalid video ID" }, { status: 400 });
  }

  // Check for cached segmentation on disk
  try {
    await access(maskPath(videoId));
    console.log(`[segment] Cache hit for ${videoId}`);
    return Response.json({ cached: true });
  } catch {
    // not cached, continue
  }

  const filePath = path.join(VIDEO_DIR, `${videoId}.mp4`);

  try {
    await access(filePath);
  } catch {
    return Response.json(
      { error: "Video not yet downloaded" },
      { status: 404 }
    );
  }

  try {
    const buffer = await readFile(filePath);
    const videoBase64 = buffer.toString("base64");

    console.log(
      `[segment] Starting Modal segmentation for ${videoId} (${buffer.length} bytes)`
    );

    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min

    const modalRes = await fetch(MODAL_ENDPOINT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_base64: videoBase64 }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!modalRes.ok) {
      const errorText = await modalRes.text();
      throw new Error(`Modal returned ${modalRes.status}: ${errorText}`);
    }

    const result = await modalRes.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.error) {
      throw new Error(result.error);
    }

    console.log(
      `[segment] Modal segmentation done in ${elapsed}s (${result.num_frames} frames)`
    );

    // Decode and save mask video to disk
    const maskBuffer = Buffer.from(result.mask_video_base64, "base64");
    await mkdir(VIDEO_DIR, { recursive: true });
    await writeFile(maskPath(videoId), maskBuffer);

    console.log(
      `[segment] Saved mask for ${videoId} (${maskBuffer.length} bytes)`
    );

    return Response.json({ cached: true });
  } catch (err) {
    console.error("[segment] Segmentation error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Segmentation failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({ configured: true });
}
