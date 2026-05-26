// Relay entry — uses Bun's built-in HTTP server. Routes are dispatched by
// path prefix; each handler module owns its slice of /api/*.

import { CONFIG, maskSecret } from "./config.ts";
import { getDb } from "./db.ts";
import { createRun, getRun } from "./routes/public.ts";
import { getInput, pollJob, postError, postResult } from "./routes/worker.ts";

// Force DB init (and config validation) at boot — fail fast.
getDb();

const RUN_GET = /^\/api\/runs\/(\d+)$/;
const WORKER_INPUT = /^\/api\/worker\/input\/(\d+)$/;
const WORKER_RESULT = /^\/api\/worker\/result\/(\d+)$/;
const WORKER_ERROR = /^\/api\/worker\/error\/(\d+)$/;

const server = Bun.serve({
  port: CONFIG.port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // CORS for browser clients — same-origin would suffice in dev with a
    // Vite proxy; this keeps it usable cross-origin too.
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    let res: Response;
    try {
      res = await route(req, path, method);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("[relay] handler threw:", m);
      res = Response.json({ error: m }, { status: 500 });
    }
    // Always echo CORS headers on responses.
    for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
    return res;
  },
});

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
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

  // Public API
  if (path === "/api/runs" && method === "POST") {
    return createRun(req);
  }
  const m = path.match(RUN_GET);
  if (m && method === "GET") {
    return getRun(m[1]!);
  }

  // Worker API
  if (path === "/api/worker/poll" && method === "GET") return pollJob(req);
  const wi = path.match(WORKER_INPUT);
  if (wi && method === "GET") return getInput(req, wi[1]!);
  const wr = path.match(WORKER_RESULT);
  if (wr && method === "POST") return postResult(req, wr[1]!);
  const we = path.match(WORKER_ERROR);
  if (we && method === "POST") return postError(req, we[1]!);

  return new Response("not found", { status: 404 });
}

console.log(`[relay] listening on http://localhost:${server.port}`);
console.log(`[relay] network=${CONFIG.network} contract=${CONFIG.gameHubContractId}`);
console.log(`[relay] relay key=${maskSecret(CONFIG.relaySecretKey)} game_id=${CONFIG.gameId}`);
