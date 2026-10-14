import { head, list, put } from "@vercel/blob";
import type { AppMode } from "../shared/mode";

/**
 * Reference videos live in Vercel Blob so every device (laptop, headset,
 * judges' browsers) shares one library and serverless instances don't
 * depend on a local /tmp.
 *
 *   videos/<id>.mp4   the video
 *   videos/<id>.json  { id, title, mode, source, createdAt }
 */
export type VideoMeta = {
  id: string;
  title: string;
  mode: AppMode;
  source: "youtube" | "upload";
  createdAt: string;
};

export type LibraryEntry = VideoMeta & { url: string };

export const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export const videoPathname = (id: string) => `videos/${id}.mp4`;
const metaPathname = (id: string) => `videos/${id}.json`;

export async function getVideoUrl(id: string): Promise<string | null> {
  try {
    return (await head(videoPathname(id))).url;
  } catch {
    return null;
  }
}

export async function getVideoMeta(id: string): Promise<VideoMeta | null> {
  try {
    const { url } = await head(metaPathname(id));
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as VideoMeta) : null;
  } catch {
    return null;
  }
}

export async function saveVideoMeta(meta: VideoMeta): Promise<void> {
  await put(metaPathname(meta.id), JSON.stringify(meta), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function saveVideo(
  id: string,
  body: Buffer | ReadableStream | Blob,
): Promise<string> {
  const { url } = await put(videoPathname(id), body, {
    access: "public",
    contentType: "video/mp4",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
  });
  return url;
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const { blobs } = await list({ prefix: "videos/", limit: 1000 });
  const urls = new Map(
    blobs
      .filter((b) => b.pathname.endsWith(".mp4"))
      .map((b) => [b.pathname.slice("videos/".length, -".mp4".length), b.url]),
  );
  const metas = await Promise.all(
    blobs
      .filter((b) => b.pathname.endsWith(".json"))
      .map(async (b) => {
        try {
          const res = await fetch(b.url, { cache: "no-store" });
          return res.ok ? ((await res.json()) as VideoMeta) : null;
        } catch {
          return null;
        }
      }),
  );
  return metas
    .filter((m): m is VideoMeta => !!m && urls.has(m.id))
    .map((m) => ({ ...m, url: urls.get(m.id)! }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
