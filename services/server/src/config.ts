// Centralised env reading. Loud failure on missing required vars.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[config] required env var ${name} is missing or empty`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const CONFIG = {
  port: Number(optional("PORT", "8787")),
  dbPath: optional("DB_PATH", "./.data/relay.db"),
  workerApiKey: required("WORKER_API_KEY"),
  network: optional("NETWORK", "testnet") as "testnet" | "mainnet",
  rpcUrl: required("STELLAR_RPC_URL"),
  networkPassphrase: required("STELLAR_NETWORK_PASSPHRASE"),
  gameHubContractId: required("GAME_HUB_CONTRACT_ID"),
  relaySecretKey: required("RELAY_SECRET_KEY"),
  gameId: Number(optional("GAME_ID", "1")),
};

export function maskSecret(s: string): string {
  if (s.length <= 8) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
