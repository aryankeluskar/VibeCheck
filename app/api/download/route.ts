import { NextRequest } from "next/server";
import { classifyVideo } from "../../lib/classifyVideo";
import {
  VIDEO_ID_RE,
  YOUTUBE_ID_RE,
  getVideoMeta,
  getVideoUrl,
  saveVideo,
  saveVideoMeta,
} from "../../lib/videoStore";
import { downloadInSandbox, downloadLocal, hasLocalYtDlp } from "../../lib/ytdlp";

export const maxDuration = 300;

/**
 * SSE stream: progress → done → classified, or error.
 * Order of sources: Blob library cache → local yt-dlp (dev) → Vercel Sandbox.
 */
export async function POST(request: NextRequest) {
  const { videoId } = (await request.json()) as { videoId: string };

  if (!videoId || !VIDEO_ID_RE.test(videoId)) {
    return Response.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (data: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (!closed) { closed = true; controller.close(); }
      };

      try {
        const cachedUrl = await getVideoUrl(videoId);
        if (cachedUrl) {
          const meta = await getVideoMeta(videoId);
          emit({ type: "progress", percent: 100 });
          emit({ type: "done", url: cachedUrl });
          emit({ type: "classified", mode: meta?.mode ?? "dance", title: meta?.title ?? "" });
          return close();
        }

        if (!YOUTUBE_ID_RE.test(videoId)) {
          emit({ type: "error", message: "That video isn't in the library." });
          return close();
        }

        const onProgress = (percent: number, phase?: string) =>
          emit({ type: "progress", percent: Math.round(percent), phase });

        const local = await hasLocalYtDlp();
        const { data, meta } = local
          ? await downloadLocal(videoId, onProgress)
          : await downloadInSandbox(videoId, onProgress);

        emit({ type: "progress", percent: 92, phase: "saving" });
        const [url, mode] = await Promise.all([
          saveVideo(videoId, data),
          classifyVideo(meta.title, meta.description),
        ]);
        await saveVideoMeta({
          id: videoId,
          title: meta.title,
          mode,
          source: "youtube",
          createdAt: new Date().toISOString(),
        });

        emit({ type: "progress", percent: 100 });
        emit({ type: "done", url });
        emit({ type: "classified", mode, title: meta.title });
      } catch (err) {
        console.error("[download]", err);
        const message = err instanceof Error ? err.message : "Download failed";
        emit({
          type: "error",
          message: `${message} Pick a video from the library or upload a clip instead.`,
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
