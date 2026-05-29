// Pending-proof cache in localStorage. The proof was built by the relay
// but not yet signed + submitted by the player's wallet. Survives a tab
// close so the player can come back and sign later.
//
// Only ONE pending proof is tracked at a time. Generating a new proof
// overwrites any previous unsigned one.
//
// Two flavors based on which relay PROVE_MODE produced it:
//   - "zk":     seal + journal → game_hub::submit_score
//   - "attest": journal + signature → game_hub::settle_attested

const KEY = "flight.pendingProof";

interface PendingProofBase {
  player_strkey: string;
  score: number;
  ticks_survived: number;
  proved_at: number; // unix ms
}
export interface PendingProofZk extends PendingProofBase {
  kind?: "zk"; // omitted on legacy entries — defaulted to zk
  seal_hex: string;
  journal_hex: string;
}
export interface PendingProofAttest extends PendingProofBase {
  kind: "attest";
  game_id: number;
  journal_hex: string;
  signature_hex: string;
}
export type PendingProof = PendingProofZk | PendingProofAttest;

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
      typeof p.player_strkey !== "string" ||
      typeof p.score !== "number" ||
      typeof p.ticks_survived !== "number"
    ) {
      return null;
    }
    if (p.kind === "attest") {
      if (
        typeof p.journal_hex !== "string" ||
        typeof p.signature_hex !== "string" ||
        typeof p.game_id !== "number"
      ) {
        return null;
      }
      return p;
    }
    // Default branch (kind missing or kind="zk"): require seal + journal.
    if (
      typeof (p as PendingProofZk).seal_hex !== "string" ||
      typeof (p as PendingProofZk).journal_hex !== "string"
    ) {
      return null;
    }
    return p;
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
