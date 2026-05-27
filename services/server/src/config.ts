// Centralised env reading. Loud failure on missing required vars.

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const CONFIG = {
  port: Number(optional("PORT", "8787")),
  flightHostBin: optional("FLIGHT_HOST_BIN", "../../target/release/flight-host"),
  submitCooldownSeconds: Number(optional("SUBMIT_COOLDOWN_SECONDS", "60")),
  /// "groth16" (default, on-chain submittable) | "stark" (--local, dev only)
  /// | "stub" (--stub-seal, lets the on-chain path land while contract
  /// uses MockVerifier). Set to "stub" for end-to-end testnet smoke
  /// without needing Docker+Groth16.
  proveMode: optional("PROVE_MODE", "groth16") as "groth16" | "stark" | "stub",
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
};
