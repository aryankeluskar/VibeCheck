export type GroqScoreResult = {
  score: number;
  smoothedScore: number;
  limbDetail: Record<string, number>;
  feedback: string;
};

const EMA_ALPHA = 0.25;
const MAX_CONSECUTIVE_ERRORS = 3;

let smoothedScore: number | null = null;
let consecutiveErrors = 0;

export function resetGroqScoring(): void {
  smoothedScore = null;
  consecutiveErrors = 0;
}

export function startGroqScoring(
  captureReference: () => string | null,
  captureWebcam: () => string | null,
  onScore: (result: GroqScoreResult) => void,
  intervalMs: number = 3000
): () => void {
  let currentInterval = intervalMs;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let inflight = false;

  const tick = async () => {
    if (stopped || inflight) return;

    const referenceFrame = captureReference();
    const webcamFrame = captureWebcam();
    if (!referenceFrame || !webcamFrame) return;

    inflight = true;
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceFrame, webcamFrame }),
      });

      if (!res.ok) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && timer) {
          clearInterval(timer);
          currentInterval = Math.min(currentInterval * 2, 30000);
          timer = setInterval(tick, currentInterval);
        }
        return;
      }

      const data = await res.json();
      consecutiveErrors = 0;

      // Reset interval back to normal on success if it was backed off
      if (currentInterval !== intervalMs && timer) {
        clearInterval(timer);
        currentInterval = intervalMs;
        timer = setInterval(tick, currentInterval);
      }

      const rawScore = typeof data.score === "number" ? data.score : 50;

      if (smoothedScore === null) {
        smoothedScore = rawScore;
      } else {
        smoothedScore = EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * smoothedScore;
      }

      onScore({
        score: rawScore,
        smoothedScore: Math.round(smoothedScore as number),
        limbDetail: data.limbDetail ?? {},
        feedback: typeof data.feedback === "string" ? data.feedback : "",
      });
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && timer) {
        clearInterval(timer);
        currentInterval = Math.min(currentInterval * 2, 30000);
        timer = setInterval(tick, currentInterval);
      }
    } finally {
      inflight = false;
    }
  };

  timer = setInterval(tick, currentInterval);
  // Run first tick immediately
  tick();

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
