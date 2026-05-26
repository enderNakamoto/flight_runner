// Pending-proof cache in localStorage. The proof was built by the relay
// but not yet signed + submitted by the player's wallet. Survives a tab
// close so the player can come back and sign later.
//
// Only ONE pending proof is tracked at a time. Generating a new proof
// overwrites any previous unsigned one.

const KEY = "flight.pendingProof";

export interface PendingProof {
  player_strkey: string;
  seal_hex: string;
  journal_hex: string;
  score: number;
  ticks_survived: number;
  proved_at: number; // unix ms
}

const subscribers = new Set<(p: PendingProof | null) => void>();

function notify(p: PendingProof | null) {
  for (const s of subscribers) s(p);
}

export function getPendingProof(): PendingProof | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingProof;
    if (
      typeof p.player_strkey === "string" &&
      typeof p.seal_hex === "string" &&
      typeof p.journal_hex === "string" &&
      typeof p.score === "number" &&
      typeof p.ticks_survived === "number"
    ) {
      return p;
    }
    return null;
  } catch {
    return null;
  }
}

export function setPendingProof(p: PendingProof): void {
  localStorage.setItem(KEY, JSON.stringify(p));
  notify(p);
}

export function clearPendingProof(): void {
  localStorage.removeItem(KEY);
  notify(null);
}

export function onPendingProofChange(cb: (p: PendingProof | null) => void): () => void {
  subscribers.add(cb);
  cb(getPendingProof());
  return () => subscribers.delete(cb);
}
