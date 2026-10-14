/**
 * Extracts a YouTube video ID from various URL formats.
 */
export function extractVideoId(url: string): string | null {
  if (!url) return null;

  // Handle youtu.be short links
  const shortMatch = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/
  );
  if (shortMatch) return shortMatch[1];

  // Handle youtube.com/watch?v=...
  const longMatch = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/
  );
  if (longMatch) return longMatch[1];

  // Handle youtube.com/embed/...
  const embedMatch = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
  );
  if (embedMatch) return embedMatch[1];

  // Handle youtube.com/shorts/...
  const shortsMatch = url.match(
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  );
  if (shortsMatch) return shortsMatch[1];

  return null;
}

/**
 * Builds a YouTube embed URL from a video ID.
 */
export function buildEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
}
