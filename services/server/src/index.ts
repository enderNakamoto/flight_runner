// Relay entry — uses Bun's built-in HTTP server. Routes are dispatched by
// path prefix; each handler module owns its slice of /api/*.

import { CONFIG, maskSecret } from "./config.ts";
import { getDb } from "./db.ts";

// Force DB init (and config validation) at boot — fail fast.
getDb();

const server = Bun.serve({
  port: CONFIG.port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Health probe — useful for Fly Machines liveness checks (Phase 7).
    if (path === "/health") {
      return Response.json({
        ok: true,
        network: CONFIG.network,
        contract: CONFIG.gameHubContractId,
        game_id: CONFIG.gameId,
      });
    }

    // Public API (slice 2) and worker API (slice 3) land in later commits.
    if (path.startsWith("/api/")) {
      return new Response("not implemented yet", { status: 501 });
    }

    return new Response("not found", { status: 404 });
  },
});

console.log(`[relay] listening on http://localhost:${server.port}`);
console.log(`[relay] network=${CONFIG.network} contract=${CONFIG.gameHubContractId}`);
console.log(`[relay] relay key=${maskSecret(CONFIG.relaySecretKey)} game_id=${CONFIG.gameId}`);
