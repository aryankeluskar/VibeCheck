import { NextRequest, NextResponse } from "next/server";
import { VIDEO_ID_RE, getVideoUrl } from "../../../lib/videoStore";

/**
 * Redirects to the reference video in Vercel Blob. Blob serves byte ranges
 * and `Access-Control-Allow-Origin: *`, so a `crossOrigin="anonymous"`
 * <video> stays readable by canvas capture and MediaPipe.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!VIDEO_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }

  const url = await getVideoUrl(id);
  if (!url) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  return NextResponse.redirect(url, {
    status: 307,
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
