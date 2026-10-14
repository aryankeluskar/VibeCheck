import { NextRequest, NextResponse } from "next/server";
import { stat, open } from "fs/promises";
import path from "path";

const VIDEO_DIR = "/tmp/jigglewiggle";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  if (!/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const filePath = path.join(VIDEO_DIR, `${videoId}_mask.mp4`);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Segmented video not found" }, { status: 404 });
  }

  const fileSize = fileStat.size;
  const rangeHeader = request.headers.get("range");

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new NextResponse("Invalid range", { status: 416 });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      return new NextResponse("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    const fileHandle = await open(filePath, "r");
    const stream = fileHandle.createReadStream({ start, end });

    let cancelled = false;
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: string | Buffer) => {
          if (!cancelled) controller.enqueue(chunk);
        });
        stream.on("end", () => {
          if (!cancelled) controller.close();
          fileHandle.close();
        });
        stream.on("error", (err) => {
          if (!cancelled) controller.error(err);
          fileHandle.close();
        });
      },
      cancel() {
        cancelled = true;
        stream.destroy();
        fileHandle.close();
      },
    });

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunkSize.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  const fileHandle = await open(filePath, "r");
  const stream = fileHandle.createReadStream();

  let cancelled = false;
  const webStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk: string | Buffer) => {
        if (!cancelled) controller.enqueue(chunk);
      });
      stream.on("end", () => {
        if (!cancelled) controller.close();
        fileHandle.close();
      });
      stream.on("error", (err) => {
        if (!cancelled) controller.error(err);
        fileHandle.close();
      });
    },
    cancel() {
      cancelled = true;
      stream.destroy();
      fileHandle.close();
    },
  });

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": fileSize.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
