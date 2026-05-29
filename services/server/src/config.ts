// Centralised env reading. Loud failure on missing required vars.

import { Keypair } from "@stellar/stellar-sdk";

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const CONFIG = {
  port: Number(optional("PORT", "8787")),
  flightHostBin: optional("FLIGHT_HOST_BIN", "../../target/release/flight-host"),
  /// flight-replay binary (Phase 13 attest mode). No R0 / Boundless deps,
  /// so a cheap VPS without rzup can still build + run it.
  flightReplayBin: optional("FLIGHT_REPLAY_BIN", "../../target/release/flight-replay"),
  submitCooldownSeconds: Number(optional("SUBMIT_COOLDOWN_SECONDS", "60")),
  /// "groth16" (default, on-chain submittable via local r0vm) |
  /// "stark"   (--local, dev only) |
  /// "stub"    (--stub-seal, lets the on-chain path land while contract
  ///           uses MockVerifier) |
  /// "boundless" (--boundless, outsources proving to the Boundless
  ///           marketplace; same 260-byte seal returned) |
  /// "attest"  (Phase 13 — native replay + ed25519 op signature, no
  ///           ZK at all; calls game_hub::settle_attested).
  proveMode: optional("PROVE_MODE", "groth16") as
    | "groth16"
    | "stark"
    | "stub"
    | "boundless"
    | "attest",
  /// Which game_hub game_id the relay attests for. Bound into the
  /// signed-payload prefix so a signature can't be cross-replayed
  /// against a different game on the same contract. Only consulted
  /// when proveMode === "attest".
  gameId: Number(optional("GAME_ID", "1")),
  /// Stellar S… strkey for the operator that signs settle_attested
  /// payloads. Required when proveMode === "attest". Treat as a hot
  /// secret — never commit; rotate via the contract's
  /// set_trusted_operator if leaked.
  operatorSecretKey: optional("OPERATOR_SECRET_KEY", ""),
  /// Which EVM chain the Boundless marketplace lives on. Only consulted
  /// when proveMode === "boundless". Valid values map to BoundlessMarket
  /// deployment constants in flight-host. Switching testnet ↔ mainnet =
  /// change this one env var and restart the relay.
  boundlessNetwork: optional("BOUNDLESS_NETWORK", "") as
    | ""
    | "ethereum-sepolia"
    | "base-sepolia"
    | "base-mainnet"
    | "ethereum-mainnet",
  /// Comma-separated list of allowed CORS origins, or "*" for any.
  /// Production: "https://proofarcade.xyz". Default "*" so local dev
  /// against the relay just works.
  corsOrigins: optional("CORS_ORIGIN", "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /// Fine-grained GitHub PAT with `Actions: write` scope on
  /// enderNakamoto/flight_runner. Used to fire a repository_dispatch
  /// event right after a player settles a score, so the indexer
  /// workflow refreshes the JSON snapshot within ~30s instead of
  /// waiting for the next 5-min cron. Empty = endpoint returns 503.
  githubDispatchToken: optional("GITHUB_DISPATCH_TOKEN", ""),
  /// Target repo for the dispatch event. owner/repo format.
  githubRepo: optional("GITHUB_REPO", "enderNakamoto/flight_runner"),
  /// Floor between successive dispatches from the same relay, in
  /// seconds. Prevents firing 30 dispatches if 30 players settle in
  /// the same second. GitHub Actions only needs ~one trigger per cron
  /// window anyway.
  refreshDebounceSeconds: Number(optional("REFRESH_DEBOUNCE_SECONDS", "20")),
  /// 4-byte selector (hex, no 0x prefix) that the on-chain verifier
  /// uses to identify which receipt format this seal belongs to.
  /// Nethermind's stellar-risc0-verifier currently uses "73c457ba".
  /// When set AND PROVE_MODE != "stub", the relay prepends this to
  /// the Groth16 SNARK bytes that flight-host outputs, so the final
  /// 260-byte seal starts with the selector the verifier expects.
  /// Empty / unset = no prefix added (stub mode just outputs 260 zeros).
  verifierSelectorHex: optional("VERIFIER_SELECTOR_HEX", ""),
};

if (CONFIG.verifierSelectorHex) {
  const sel = CONFIG.verifierSelectorHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{8}$/.test(sel)) {
    throw new Error(
      `VERIFIER_SELECTOR_HEX must be exactly 4 bytes (8 hex chars), got: ${CONFIG.verifierSelectorHex}`,
    );
  }
}

if (CONFIG.proveMode === "boundless") {
  const validNetworks = [
    "ethereum-sepolia",
    "base-sepolia",
    "base-mainnet",
    "ethereum-mainnet",
  ];
  if (!validNetworks.includes(CONFIG.boundlessNetwork)) {
    throw new Error(
      `PROVE_MODE=boundless requires BOUNDLESS_NETWORK to be one of ${validNetworks.join(" | ")}, got: '${CONFIG.boundlessNetwork}'`,
    );
  }
  if (!process.env.BOUNDLESS_PRIVATE_KEY) {
    throw new Error(
      "PROVE_MODE=boundless requires BOUNDLESS_PRIVATE_KEY (0x-prefixed hex) — see docs/boundless-wallet.md",
    );
  }
  if (!process.env.PINATA_JWT) {
    throw new Error(
      "PROVE_MODE=boundless requires PINATA_JWT for IPFS uploads — get one at https://pinata.cloud",
    );
  }
}

if (CONFIG.proveMode === "attest") {
  if (!CONFIG.operatorSecretKey) {
    throw new Error(
      "PROVE_MODE=attest requires OPERATOR_SECRET_KEY (Stellar S… strkey) — see README Proving modes section",
    );
  }
  try {
    Keypair.fromSecret(CONFIG.operatorSecretKey);
  } catch (e) {
    throw new Error(
      `OPERATOR_SECRET_KEY is not a valid Stellar S… strkey: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  if (!Number.isInteger(CONFIG.gameId) || CONFIG.gameId < 0) {
    throw new Error(
      `PROVE_MODE=attest requires GAME_ID to be a non-negative integer, got: '${process.env.GAME_ID}'`,
    );
  }
}
