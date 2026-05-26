// Module-level buffer for the most recent transcript captured during a
// run. PlayScene writes here at game over; the wallet panel reads it to
// build a relay submission.

let latest: Uint8Array | null = null;

const subscribers = new Set<(t: Uint8Array | null) => void>();

export function setLatestTranscript(bytes: Uint8Array): void {
  latest = bytes;
  for (const s of subscribers) s(latest);
}

export function clearLatestTranscript(): void {
  latest = null;
  for (const s of subscribers) s(null);
}

export function getLatestTranscript(): Uint8Array | null {
  return latest;
}

export function onTranscriptChange(cb: (t: Uint8Array | null) => void): () => void {
  subscribers.add(cb);
  cb(latest);
  return () => subscribers.delete(cb);
}
