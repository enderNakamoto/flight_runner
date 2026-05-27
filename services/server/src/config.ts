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
};
