// Relay entry — Bun HTTP server. Single endpoint: POST /api/submit-score.
// No DB, no queue, no workers — the contract is the only persistent state.

import { CONFIG, maskSecret } from "./config.ts";
import { handleSubmitScore } from "./submit.ts";

const server = Bun.serve({
  port: CONFIG.port,
  idleTimeout: 0, // Bun caps idle at 255s by default; 0 = no cap so a real
                  // Groth16 wrap (15–25 min) can finish without the socket dying.
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    let res: Response;
    try {
      res = await route(req, path, method);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("[relay] handler threw:", m);
      res = Response.json({ ok: false, error: m }, { status: 500 });
    }
    for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
    return res;
  },
});

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

async function route(req: Request, path: string, method: string): Promise<Response> {
  if (path === "/health") {
    return Response.json({
      ok: true,
      network: CONFIG.network,
      contract: CONFIG.gameHubContractId,
      game_id: CONFIG.gameId,
    });
  }
  if (path === "/api/submit-score" && method === "POST") {
    return handleSubmitScore(req);
  }
  return new Response("not found", { status: 404 });
}

console.log(`[relay] listening on http://localhost:${server.port}`);
console.log(`[relay] network=${CONFIG.network} contract=${CONFIG.gameHubContractId}`);
console.log(`[relay] relay key=${maskSecret(CONFIG.relaySecretKey)} game_id=${CONFIG.gameId}`);
console.log(`[relay] flight-host=${CONFIG.flightHostBin}`);
