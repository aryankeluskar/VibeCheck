/**
 * Extracts a mask indicating foreground (person) pixels.
 * Returns ImageData where alpha channel is 255 for foreground, 0 for background.
 */
export function extractMask(
  maskVideo: HTMLVideoElement,
  tempCanvas: HTMLCanvasElement
): ImageData | null {
  const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(maskVideo, 0, 0, tempCanvas.width, tempCanvas.height);

  try {
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imageData.data;
    const width = tempCanvas.width;
    const height = tempCanvas.height;

    const maskData = ctx.createImageData(width, height);
    const mask = maskData.data;

    for (let i = 0; i < data.length; i += 4) {
      const isForeground = data[i] > 128; // White pixels are foreground
      mask[i] = 0;       // R
      mask[i + 1] = 0;   // G
      mask[i + 2] = 0;   // B
      mask[i + 3] = isForeground ? 0 : 51; // 20% opacity (51/255 ≈ 0.2) for background
    }

    return maskData;
  } catch (err) {
    console.error("Error extracting mask:", err);
    return null;
  }
}

/**
 * Extracts an "oreo" outline from a mask video frame.
 * The mask video has white foreground (person) on black background.
 * This creates a 3-layer border: black (outer), white (middle), black (inner).
 */
export function extractOutline(
  maskVideo: HTMLVideoElement,
  tempCanvas: HTMLCanvasElement
): ImageData | null {
  const ctx = tempCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(maskVideo, 0, 0, tempCanvas.width, tempCanvas.height);

  try {
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imageData.data;
    const width = tempCanvas.width;
    const height = tempCanvas.height;

    const outlineData = ctx.createImageData(width, height);
    const outline = outlineData.data;

    // Initialize fully transparent
    for (let i = 0; i < outline.length; i += 4) {
      outline[i + 3] = 0;
    }

    // Helper to check if pixel is foreground (white in mask)
    const isForeground = (x: number, y: number) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return data[(y * width + x) * 4] > 128;
    };

    // Helper to get distance to nearest background pixel
    const distanceToBackground = (x: number, y: number, maxDist: number) => {
      for (let dist = 1; dist <= maxDist; dist++) {
        for (let dy = -dist; dy <= dist; dy++) {
          for (let dx = -dist; dx <= dist; dx++) {
            if (Math.abs(dx) === dist || Math.abs(dy) === dist) {
              if (!isForeground(x + dx, y + dy)) {
                return dist;
              }
            }
          }
        }
      }
      return maxDist + 1;
    };

    // Create thinner oreo border: black (1px), white (3px), black (1px) = 5px total
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isForeground(x, y)) {
          const dist = distanceToBackground(x, y, 5);
          const idx = (y * width + x) * 4;

          // Inner black (1px from edge)
          if (dist === 1) {
            outline[idx] = 0;       // R
            outline[idx + 1] = 0;   // G
            outline[idx + 2] = 0;   // B
            outline[idx + 3] = 255; // A
          }
          // Middle white (2-4px from edge)
          else if (dist >= 2 && dist <= 4) {
            outline[idx] = 255;     // R
            outline[idx + 1] = 255; // G
            outline[idx + 2] = 255; // B
            outline[idx + 3] = 255; // A
          }
          // Outer black (5px from edge)
          else if (dist === 5) {
            outline[idx] = 0;       // R
            outline[idx + 1] = 0;   // G
            outline[idx + 2] = 0;   // B
            outline[idx + 3] = 255; // A
          }
        }
      }
    }

    return outlineData;
  } catch (err) {
    console.error("Error extracting outline:", err);
    return null;
  }
}
