const CAPTURE_WIDTH = 320;
const CAPTURE_HEIGHT = 240;

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

function getCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = CAPTURE_WIDTH;
    offscreenCanvas.height = CAPTURE_HEIGHT;
    offscreenCtx = offscreenCanvas.getContext("2d");
  }
  if (!offscreenCtx) return null;
  return { canvas: offscreenCanvas, ctx: offscreenCtx };
}

export function captureVideoFrame(
  video: HTMLVideoElement,
  mirror?: boolean
): string | null {
  if (!video || video.readyState < 2) return null;

  const pair = getCanvas();
  if (!pair) return null;
  const { canvas, ctx } = pair;

  ctx.save();
  if (mirror) {
    ctx.scale(-1, 1);
    ctx.drawImage(video, -CAPTURE_WIDTH, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  } else {
    ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  }
  ctx.restore();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
  // Strip the data:image/jpeg;base64, prefix
  const commaIdx = dataUrl.indexOf(",");
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}
