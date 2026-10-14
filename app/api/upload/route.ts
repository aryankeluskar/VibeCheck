import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

/**
 * Issues client-upload tokens so browsers upload straight to Vercel Blob
 * (function request bodies are capped at 4.5 MB). Only reference videos and
 * session recordings are allowed.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (/^videos\/up_[a-zA-Z0-9_-]{6,40}\.mp4$/.test(pathname)) {
          return {
            allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm"],
            maximumSizeInBytes: 200 * 1024 * 1024,
            addRandomSuffix: false,
          };
        }
        if (/^recordings\/[a-zA-Z0-9-]{8,64}\.webm$/.test(pathname)) {
          return {
            allowedContentTypes: ["video/webm", "video/mp4"],
            maximumSizeInBytes: 300 * 1024 * 1024,
            addRandomSuffix: false,
          };
        }
        throw new Error("Upload path not allowed");
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
