// Worker-facing API.
//
// All endpoints under /api/worker require a bearer token matching
// WORKER_API_KEY. Treat it as a shared secret between relay and workers.
//
// Lifecycle: pending → proving → settled | failed.
// Poll atomically claims the next pending row and flips it to 'proving'
// so two concurrent workers can't grab the same job.

import { submitScore } from "../chain.ts";
import { CONFIG } from "../config.ts";
import { getDb, now, type RunRow } from "../db.ts";

const SEAL_HEX_LEN = 260 * 2;
const JOURNAL_HEX_LEN = 76 * 2;

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

function checkAuth(req: Request): Response | null {
  const auth = req.headers.get("authorization") || "";
  const expect = `Bearer ${CONFIG.workerApiKey}`;
  if (auth !== expect) return jsonError(401, "missing or bad bearer token");
  return null;
}

export function pollJob(req: Request): Response {
  const fail = checkAuth(req);
  if (fail) return fail;

  const db = getDb();
  // Atomic claim: SELECT + UPDATE wrapped in one immediate write
  // transaction so two workers polling concurrently can't double-claim.
  const claimed = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id FROM runs WHERE proof_status = 'pending' ORDER BY id LIMIT 1`,
      )
      .get() as { id: number } | null;
    if (!row) return null;
    const ts = now();
    db.prepare(
      `UPDATE runs SET proof_status = 'proving', updated_at = ? WHERE id = ? AND proof_status = 'pending'`,
    ).run(ts, row.id);
    return row.id;
  })();

  if (claimed === null) {
    return new Response(null, { status: 204 });
  }
  return Response.json({ run_id: claimed });
}

export function getInput(req: Request, idStr: string): Response {
  const fail = checkAuth(req);
  if (fail) return fail;

  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, "bad run id");

  const row = getDb()
    .prepare(`SELECT transcript, player_strkey, player_pubkey_hex FROM runs WHERE id = ?`)
    .get(id) as
    | Pick<RunRow, "transcript" | "player_strkey" | "player_pubkey_hex">
    | null;
  if (!row) return jsonError(404, `run #${id} not found`);

  return Response.json({
    run_id: id,
    player_strkey: row.player_strkey,
    player_pubkey_hex: row.player_pubkey_hex,
    transcript_b64: Buffer.from(row.transcript).toString("base64"),
  });
}

export async function postResult(req: Request, idStr: string): Promise<Response> {
  const fail = checkAuth(req);
  if (fail) return fail;

  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, "bad run id");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (!body || typeof body !== "object") return jsonError(400, "body must be JSON object");

  const { seal_hex, journal_hex } = body as {
    seal_hex?: unknown;
    journal_hex?: unknown;
  };
  if (typeof seal_hex !== "string" || seal_hex.length !== SEAL_HEX_LEN) {
    return jsonError(400, `seal_hex must be ${SEAL_HEX_LEN} hex chars (260 bytes)`);
  }
  if (typeof journal_hex !== "string" || journal_hex.length !== JOURNAL_HEX_LEN) {
    return jsonError(400, `journal_hex must be ${JOURNAL_HEX_LEN} hex chars (76 bytes)`);
  }
  if (!/^[0-9a-fA-F]+$/.test(seal_hex) || !/^[0-9a-fA-F]+$/.test(journal_hex)) {
    return jsonError(400, "seal_hex/journal_hex must be hex");
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT id, proof_status FROM runs WHERE id = ?`)
    .get(id) as { id: number; proof_status: string } | null;
  if (!row) return jsonError(404, `run #${id} not found`);
  if (row.proof_status !== "proving") {
    return jsonError(409, `run #${id} not in 'proving' state (got '${row.proof_status}')`);
  }

  // Stash artifacts before attempting the on-chain submit so they survive
  // even if the chain call fails — the relay (or an admin) can retry the
  // submit later without re-proving.
  db.prepare(
    `UPDATE runs SET seal_hex = ?, journal_hex = ?, updated_at = ? WHERE id = ?`,
  ).run(seal_hex, journal_hex, now(), id);

  // Auto-settle: call game_hub::submit_score with the relay's keypair.
  const submit = await submitScore(CONFIG.gameId, seal_hex, journal_hex);
  if (submit.ok) {
    db.prepare(
      `UPDATE runs SET proof_status = 'settled', tx_hash = ?, error = NULL, updated_at = ? WHERE id = ?`,
    ).run(submit.txHash, now(), id);
    console.log(`[relay] settled run #${id} · tx ${submit.txHash}`);
    return Response.json({ run_id: id, proof_status: "settled", tx_hash: submit.txHash });
  }
  db.prepare(
    `UPDATE runs SET proof_status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
  ).run(submit.error, now(), id);
  console.warn(`[relay] settle failed run #${id}: ${submit.error}`);
  return Response.json(
    { run_id: id, proof_status: "failed", error: submit.error },
    { status: 502 },
  );
}

export async function postError(req: Request, idStr: string): Promise<Response> {
  const fail = checkAuth(req);
  if (fail) return fail;

  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, "bad run id");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const message =
    (body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string"
      ? ((body as Record<string, string>).error as string)
      : "worker reported error");

  const db = getDb();
  const ts = now();
  const res = db
    .prepare(
      `UPDATE runs SET proof_status = 'failed', error = ?, updated_at = ?
         WHERE id = ? AND proof_status = 'proving'`,
    )
    .run(message, ts, id);
  if (res.changes === 0) return jsonError(409, `run #${id} not in 'proving' state`);
  return Response.json({ run_id: id, proof_status: "failed" });
}
