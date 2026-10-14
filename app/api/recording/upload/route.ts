import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.blob();
    if (body.size === 0) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    const { url } = await put(`recordings/${crypto.randomUUID()}.webm`, body, {
      access: "public",
      contentType: "video/webm",
      addRandomSuffix: false,
    });

    return NextResponse.json({ url });
  } catch (err) {
    console.error("Recording upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
