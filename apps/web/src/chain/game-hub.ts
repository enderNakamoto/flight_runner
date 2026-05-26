// Thin wrapper around the generated game_hub contract client. Plumbs the
// wallet's signTransaction callback through so client.start_run() /
// client.settle_run() can sign + submit in one call.

import { Client } from "@flight/game-hub-client";
import { CONFIG, requireContractId } from "./config.js";
import { getAddress, signTransaction } from "./wallet.js";

export function getClient(): Client {
  const publicKey = getAddress();
  if (!publicKey) throw new Error("wallet not connected");
  return new Client({
    contractId: requireContractId(),
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey,
    signTransaction,
  });
}

/// Read-only client (no wallet required) — for `get_score`, `get_run`,
/// `get_game` view calls that don't need to sign anything.
export function getReadClient(): Client {
  return new Client({
    contractId: requireContractId(),
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey: undefined,
  });
}
