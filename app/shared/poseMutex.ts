/**
 * Simple mutex to serialize pose.send() calls.
 * MediaPipe WASM can handle multiple Pose instances,
 * but only one send() can run at a time.
 */

let locked = false;
const queue: (() => void)[] = [];

export async function withPoseLock<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for lock
  if (locked) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  locked = true;
  try {
    return await fn();
  } finally {
    locked = false;
    const next = queue.shift();
    if (next) next();
  }
}
