// Relay entry — Bun HTTP server. Single endpoint: POST /api/prove.
// Pure prover; never touches Stellar.

import { CONFIG } from "./config.ts";
import { handleRefresh } from "./refresh.ts";
import { handleProve } from "./submit.ts";

const server = Bun.serve({
  port: CONFIG.port,
  idleTimeout: 0, // Bun defaults to 255s; 0 = no cap so a real Groth16
                  // wrap (15–25 min) doesn't get killed mid-prove.
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const origin = req.headers.get("origin");

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    let res: Response;
    try {
      res = await route(req, path, method);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("[relay] handler threw:", m);
      res = Response.json({ ok: false, error: m }, { status: 500 });
    }
    for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
    return res;
  },
});

/// Build CORS headers. If CORS_ORIGIN env is "*", reflect any origin (or
/// "*" when none was sent). Otherwise echo the request's origin only if
/// it's in the allowlist — silently omit the header on a mismatch so the
/// browser blocks the request without us advertising the allowlist.
function corsHeaders(reqOrigin: string | null): Record<string, string> {
  const base = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  };
  const allow = CONFIG.corsOrigins;
  if (allow.length === 1 && allow[0] === "*") {
    return { ...base, "access-control-allow-origin": reqOrigin ?? "*" };
  }
  if (reqOrigin && allow.includes(reqOrigin)) {
    return { ...base, "access-control-allow-origin": reqOrigin };
  }
  return base; // no allow-origin → browser blocks
}

async function route(req: Request, path: string, method: string): Promise<Response> {
  if (path === "/health") {
    return Response.json({ ok: true, role: "prover" });
  }
  if (path === "/api/prove" && method === "POST") {
    return handleProve(req);
  }
  if (path === "/api/refresh-leaderboard" && method === "POST") {
    return handleRefresh(req);
  }
  return new Response("not found", { status: 404 });
}

console.log(`[relay] listening on http://localhost:${server.port}`);
console.log(`[relay] flight-host=${CONFIG.flightHostBin}`);
console.log(`[relay] role=pure prover (no chain interaction)`);
