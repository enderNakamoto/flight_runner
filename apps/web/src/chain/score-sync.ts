// Whenever a wallet connects (fresh sign-in or silent reconnect at
// boot), fetch each live game's on-chain personal best and mirror it
// into localStorage. This is what makes the in-game BEST overlay
// follow the player across browsers / devices — the HUD reads from
// localStorage, the chain is the source of truth.
//
// Runs globally from main.ts. Cheap: one read per live game, fired
// only when the wallet address changes. Failures are swallowed
// silently — a stale local cache is acceptable.

import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import { Client, type HighScoreEntry } from "@flight/game-hub-client";
import { CONFIG, requireContractId } from "./config.js";
import { GAMES } from "../landing/games.js";
import { onWalletChange } from "./wallet.js";

/// Per-game localStorage keys used by each game's in-HUD BEST overlay.
/// Add a new entry here when a new game is added and uses its own
/// localStorage key for the same purpose.
const BEST_STORAGE_KEYS: Record<string, string> = {
  birdstrike: "flight_scroll:best",
};

function strkeyToPubkey(strkey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(strkey));
}

function readClient(): Client {
  return new Client({
    contractId: requireContractId(),
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey: undefined,
  });
}

/// Write `onChainBest` into the game's localStorage slot, but only if
/// it beats whatever's already there. Never lowers the local high.
export function syncLocalBest(slug: string, onChainBest: number): void {
  const key = BEST_STORAGE_KEYS[slug];
  if (!key) return;
  try {
    const localRaw = localStorage.getItem(key);
    const local = localRaw ? Number.parseInt(localRaw, 10) : 0;
    if (onChainBest > local) localStorage.setItem(key, String(onChainBest));
  } catch {}
}

/// One-shot: pull on-chain scores for every live game and mirror them
/// to localStorage.
export async function syncOnChainBestsToLocalStorage(addr: string): Promise<void> {
  if (!CONFIG.gameHubContractId) return;
  const client = readClient();
  const pubkey = strkeyToPubkey(addr);
  for (const g of GAMES) {
    if (g.status !== "live" || g.gameId === undefined) continue;
    try {
      const res = await client.get_score({
        game_id: g.gameId,
        player_pubkey: pubkey,
      });
      const entry = (res.result as HighScoreEntry | undefined) ?? null;
      if (entry) syncLocalBest(g.slug, entry.score);
    } catch {
      // ignore — local cache stays stale, contract remains the truth
    }
  }
}

let started = false;
/// Subscribe globally — fires on every wallet connect / silent restore.
/// Idempotent; safe to call multiple times.
export function startScoreSync(): void {
  if (started) return;
  started = true;
  onWalletChange((addr) => {
    if (addr) syncOnChainBestsToLocalStorage(addr).catch(() => {});
  });
}
