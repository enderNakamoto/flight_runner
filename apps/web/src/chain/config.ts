// Chain config for game_hub integration. All values are testnet defaults;
// slice 6 will pin the deployed contract id here.
//
// Override at build time with Vite env vars (VITE_*) — they're inlined into
// the bundle, so changing them needs a rebuild.

import { Networks } from "@stellar/stellar-sdk";

const env = import.meta.env as Record<string, string | undefined>;

export const CONFIG = {
  /// Soroban RPC endpoint. Default = SDF public testnet RPC.
  rpcUrl: env.VITE_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  /// Network passphrase — must match the RPC endpoint's network.
  networkPassphrase: env.VITE_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET,
  /// Deployed game_hub contract id (C...). Empty until slice 6 deploys.
  /// Wallet flows refuse to proceed when this is empty so we fail loud.
  gameHubContractId: env.VITE_GAME_HUB_CONTRACT_ID ?? "",
  /// game_id for flight_scroll inside game_hub. Admin-provided per
  /// memory/project_prover_deploy_target.md; convention reserves 1–99 for
  /// first-party games. flight_scroll = 1.
  flightScrollGameId: 1,
} as const;

export function requireContractId(): string {
  if (!CONFIG.gameHubContractId) {
    throw new Error(
      "VITE_GAME_HUB_CONTRACT_ID is not set — deploy the contract (Phase 5 slice 6) and rebuild.",
    );
  }
  return CONFIG.gameHubContractId;
}
