import { NextRequest, NextResponse } from "next/server";
import { head, put } from "@vercel/blob";
import { VIDEO_ID_RE } from "../../../lib/videoStore";

/**
 * Dense reference-pose timeline for a library video, cached in Blob so the
 * first device that analyzes a video (usually the laptop) saves the headset
 * from re-running MediaPipe over the whole clip.
 */
const POSES_VERSION = 1;
const pathname = (id: string) => `poses/${id}.v${POSES_VERSION}.json`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!VIDEO_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }
  try {
    const { url } = await head(pathname(id));
    return NextResponse.redirect(url, 307);
  } catch {
    return NextResponse.json({ error: "Not analyzed yet" }, { status: 404 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!VIDEO_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }
  const body = await req.text();
  if (body.length > 4_000_000) {
    return NextResponse.json({ error: "Timeline too large" }, { status: 413 });
  }
  let timeline: unknown;
  try {
    timeline = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return NextResponse.json({ error: "Expected a non-empty timeline" }, { status: 400 });
  }
  await put(pathname(id), body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return NextResponse.json({ ok: true, frames: timeline.length });
}
