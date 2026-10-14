import { NextRequest, NextResponse } from "next/server";
import { list, put } from "@vercel/blob";

export const dynamic = "force-dynamic";

/**
 * Remote debug beacon for the headset (no adb/devtools on the Quest during
 * the hackathon). /xr posts a state snapshot every few seconds; GET returns
 * the latest snapshot per device.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > 32_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let snap: { device?: string };
  try {
    snap = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const device = (snap.device ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "unknown";
  await put(`debug/${device}.json`, body, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { blobs } = await list({ prefix: "debug/", limit: 50 });
  const recent = blobs
    .sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
    .slice(0, 10);
  const snaps = await Promise.all(
    recent.map(async (b) => {
      try {
        const res = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
        return { uploadedAt: b.uploadedAt, ...(await res.json()) };
      } catch {
        return null;
      }
    }),
  );
  return NextResponse.json(snaps.filter(Boolean));
}
