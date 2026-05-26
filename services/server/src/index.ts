// Relay entry — Bun HTTP server. Single endpoint: POST /api/prove.
// Pure prover; never touches Stellar.

import { CONFIG } from "./config.ts";
import { handleProve } from "./submit.ts";

const server = Bun.serve({
  port: CONFIG.port,
  idleTimeout: 0, // Bun defaults to 255s; 0 = no cap so a real Groth16
                  // wrap (15–25 min) doesn't get killed mid-prove.
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
    return Response.json({ ok: true, role: "prover" });
  }
  if (path === "/api/prove" && method === "POST") {
    return handleProve(req);
  }
  return new Response("not found", { status: 404 });
}

console.log(`[relay] listening on http://localhost:${server.port}`);
console.log(`[relay] flight-host=${CONFIG.flightHostBin}`);
console.log(`[relay] role=pure prover (no chain interaction)`);
