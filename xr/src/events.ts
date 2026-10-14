/**
 * Event timeline for agents and debugging: setup steps, engine status, XR
 * visibility, runs, errors. Read it with `mirrorCoach.agent.log()`.
 * Dependency-free so any module can log without import cycles.
 */

const events: string[] = [];

export function logEvent(msg: string) {
  events.push(`${new Date().toISOString().slice(11, 23)} ${msg}`.slice(0, 300));
  if (events.length > 200) events.shift();
}

export function recentEvents(n: number) {
  return events.slice(-n);
}
