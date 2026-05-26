// Persisted across page reloads in sessionStorage so the wallet flow can
// trigger a reload and PlayScene picks up the run on init.
//
// Slice 5b sets this from the Start On-Chain Run button; PlayScene reads
// it in create() and falls back to the local Date.now() seed if absent.

const KEY = "flight.currentRun";

export interface OnChainRun {
  runId: string; // bigint serialised as decimal string
  seed: number;  // i32
  player: string;
  gameId: number;
}

export function getCurrentRun(): OnChainRun | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as OnChainRun;
    if (typeof r.seed === "number" && typeof r.runId === "string") return r;
    return null;
  } catch {
    return null;
  }
}

export function setCurrentRun(r: OnChainRun): void {
  sessionStorage.setItem(KEY, JSON.stringify(r));
}

export function clearCurrentRun(): void {
  sessionStorage.removeItem(KEY);
}
