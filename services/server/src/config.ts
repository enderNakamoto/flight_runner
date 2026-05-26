// Centralised env reading. Loud failure on missing required vars.

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const CONFIG = {
  port: Number(optional("PORT", "8787")),
  flightHostBin: optional("FLIGHT_HOST_BIN", "../../target/release/flight-host"),
  submitCooldownSeconds: Number(optional("SUBMIT_COOLDOWN_SECONDS", "60")),
};
