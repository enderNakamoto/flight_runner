// Thin wrapper around the generated game_hub contract client. Builds a
// signing client that uses the connected wallet for transaction signing.
// The player pays gas; the relay does not touch Soroban.

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
