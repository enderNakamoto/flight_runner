// POST /api/refresh-leaderboard — relay-side trigger for the indexer.
//
// Called by the browser right after `submit_score` lands. Sends a
// `repository_dispatch` event to GitHub which fires the indexer workflow
// immediately instead of waiting for the next */5 cron tick.
//
// Returns 202 on accept, 503 if the dispatch token is missing, 429 if
// debounced. Best-effort — the cron is the safety net.

import { CONFIG } from "./config.ts";

interface RefreshBody {
  player_strkey?: string;
  tx_hash?: string;
}

let lastDispatchAt = 0;

function jsonError(status: number, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export async function handleRefresh(req: Request): Promise<Response> {
  const token = CONFIG.githubDispatchToken;
  if (!token) {
    return jsonError(
      503,
      "GITHUB_DISPATCH_TOKEN not set — frontend can fall back to the cron",
    );
  }

  const now = Date.now();
  const minInterval = CONFIG.refreshDebounceSeconds * 1000;
  if (now - lastDispatchAt < minInterval) {
    const wait = Math.ceil((minInterval - (now - lastDispatchAt)) / 1000);
    return jsonError(429, `debounced — another dispatch already in flight (retry in ${wait}s)`);
  }
  lastDispatchAt = now;

  let body: RefreshBody = {};
  try {
    body = (await req.json()) as RefreshBody;
  } catch {
    // empty / non-JSON body is fine — payload is purely diagnostic
  }

  const repo = CONFIG.githubRepo;
  let dispatch: Response;
  try {
    dispatch = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({
        event_type: "refresh-leaderboard",
        client_payload: {
          player: body.player_strkey ?? null,
          tx_hash: body.tx_hash ?? null,
          triggered_at: new Date().toISOString(),
        },
      }),
    });
  } catch (e) {
    lastDispatchAt = 0; // failure shouldn't burn the debounce window
    const m = e instanceof Error ? e.message : String(e);
    return jsonError(502, `github dispatch fetch failed: ${m}`);
  }

  if (!dispatch.ok) {
    lastDispatchAt = 0;
    const text = await dispatch.text();
    return jsonError(
      dispatch.status,
      `github dispatch rejected (${dispatch.status}): ${text.slice(0, 300)}`,
    );
  }

  console.log(
    `[relay] dispatched refresh-leaderboard for ${body.player_strkey ?? "<no-strkey>"} (tx ${body.tx_hash ?? "?"})`,
  );
  return Response.json({ ok: true, debounce_seconds: CONFIG.refreshDebounceSeconds }, { status: 202 });
}
