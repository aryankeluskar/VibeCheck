import { NextRequest, NextResponse } from "next/server";
import { VIDEO_ID_RE, getVideoUrl, listLibrary, saveVideoMeta } from "../../lib/videoStore";

export const dynamic = "force-dynamic";

/** Shared reference-video library (Vercel Blob). */
export async function GET() {
  try {
    return NextResponse.json({ videos: await listLibrary() });
  } catch (err) {
    console.error("[library]", err);
    return NextResponse.json({ videos: [] });
  }
}

/** Register metadata for a video the browser just uploaded to Blob. */
export async function POST(req: NextRequest) {
  const { id, title, mode } = (await req.json()) as {
    id?: string;
    title?: string;
    mode?: string;
  };
  if (!id || !VIDEO_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid video ID" }, { status: 400 });
  }
  if (!(await getVideoUrl(id))) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }
  await saveVideoMeta({
    id,
    title: (title ?? "").slice(0, 120) || "Uploaded clip",
    mode: mode === "gym" ? "gym" : "dance",
    source: "upload",
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
