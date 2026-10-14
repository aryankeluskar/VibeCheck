import { NextRequest } from "next/server";
import { spawn, execFile } from "child_process";
import { mkdir, access } from "fs/promises";
import path from "path";
import { classifyVideo } from "../../lib/classifyVideo";

const VIDEO_DIR = "/tmp/jigglewiggle";

/** Run yt-dlp --dump-json and classify the video. Returns an SSE line. */
async function classifyFromMetadata(videoId: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return new Promise((resolve) => {
    execFile(
      "yt-dlp",
      ["--dump-json", "--no-download", url],
      { maxBuffer: 10 * 1024 * 1024 },
      async (err, stdout) => {
        if (err || !stdout) {
          resolve(
            `data: ${JSON.stringify({ type: "classified", mode: "dance", title: "" })}\n\n`
          );
          return;
        }
        try {
          const meta = JSON.parse(stdout);
          const title: string = meta.title ?? "";
          const description: string = meta.description ?? "";
          const mode = await classifyVideo(title, description);
          resolve(
            `data: ${JSON.stringify({ type: "classified", mode, title })}\n\n`
          );
        } catch {
          resolve(
            `data: ${JSON.stringify({ type: "classified", mode: "dance", title: "" })}\n\n`
          );
        }
      }
    );
  });
}

export async function POST(request: NextRequest) {
  const { videoId } = (await request.json()) as { videoId: string };

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return new Response(
      JSON.stringify({ error: "Invalid video ID" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  await mkdir(VIDEO_DIR, { recursive: true });

  const outputPath = path.join(VIDEO_DIR, `${videoId}.mp4`);

  // Check if already downloaded
  try {
    await access(outputPath);
    // File exists — return progress + classification concurrently
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "progress", percent: 100 })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        // Still classify even on cache hit (fast, no download)
        const classifiedLine = await classifyFromMetadata(videoId);
        controller.enqueue(encoder.encode(classifiedLine));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    // File doesn't exist — proceed with download
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Launch classification in parallel (non-blocking)
      const classifyPromise = classifyFromMetadata(videoId);

      const proc = spawn("yt-dlp", [
        "-f", "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio/best",
        "--merge-output-format", "mp4",
        "-o", outputPath,
        "--newline",
        url,
      ]);

      let stderrBuf = "";

      proc.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        // yt-dlp prints progress like: [download]  45.2% of ...
        const match = text.match(/\[download\]\s+([\d.]+)%/);
        if (match) {
          const percent = parseFloat(match[1]);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "progress", percent })}\n\n`)
          );
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderrBuf += data.toString();
      });

      let closed = false;
      const safeEnqueue = (data: string) => {
        if (!closed) controller.enqueue(encoder.encode(data));
      };
      const safeClose = () => {
        if (!closed) { closed = true; controller.close(); }
      };

      proc.on("error", (err) => {
        safeEnqueue(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        safeClose();
      });

      proc.on("close", async (code) => {
        if (code === 0) {
          safeEnqueue(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          // Emit classification result after download completes
          try {
            const classifiedLine = await classifyPromise;
            safeEnqueue(classifiedLine);
          } catch {
            safeEnqueue(`data: ${JSON.stringify({ type: "classified", mode: "dance", title: "" })}\n\n`);
          }
        } else {
          safeEnqueue(
            `data: ${JSON.stringify({ type: "error", message: stderrBuf.slice(-500) || `yt-dlp exited with code ${code}` })}\n\n`
          );
        }
        safeClose();
      });
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
