// Module-level buffer for the most recent run captured during play.
// PlayScene writes here at game over; the submit overlay and any other
// chain UI read it to decide what to show.

export interface CapturedRun {
  bytes: Uint8Array;   // raw .bin transcript (seed + buttons)
  score: number;       // final score
  ticks: number;       // ticks survived
}

let latest: CapturedRun | null = null;

const subscribers = new Set<(r: CapturedRun | null) => void>();

export function setLatestRun(r: CapturedRun): void {
  latest = r;
  for (const s of subscribers) s(latest);
}

export function clearLatestRun(): void {
  latest = null;
  for (const s of subscribers) s(null);
}

export function getLatestRun(): CapturedRun | null {
  return latest;
}

export function onRunChange(cb: (r: CapturedRun | null) => void): () => void {
  subscribers.add(cb);
  cb(latest);
  return () => subscribers.delete(cb);
}
