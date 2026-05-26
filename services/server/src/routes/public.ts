// Player-facing API.
//
// POST /api/runs    — submit a transcript + player strkey, get back run_id
// GET  /api/runs/:id — poll status

import { StrKey } from "@stellar/stellar-sdk";
import { getDb, now, type ProofStatus, type RunRow } from "../db.ts";

const MAX_TRANSCRIPT_BYTES = 64 * 1024; // 64 KB — well above any real run

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export async function createRun(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return jsonError(400, "body must be a JSON object");
  }
  const { player_strkey, transcript_b64 } = body as {
    player_strkey?: unknown;
    transcript_b64?: unknown;
  };
  if (typeof player_strkey !== "string") {
    return jsonError(400, "player_strkey (string) is required");
  }
  if (typeof transcript_b64 !== "string") {
    return jsonError(400, "transcript_b64 (string) is required");
  }

  // Validate strkey + extract raw pubkey.
  let pubkey: Buffer;
  try {
    pubkey = Buffer.from(StrKey.decodeEd25519PublicKey(player_strkey));
  } catch {
    return jsonError(400, "player_strkey is not a valid Stellar G… address");
  }

  // Decode + size-cap transcript.
  let transcript: Buffer;
  try {
    transcript = Buffer.from(transcript_b64, "base64");
  } catch {
    return jsonError(400, "transcript_b64 is not valid base64");
  }
  if (transcript.length < 4) {
    return jsonError(400, "transcript too short (need ≥4 byte header)");
  }
  if (transcript.length > MAX_TRANSCRIPT_BYTES) {
    return jsonError(
      413,
      `transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes (got ${transcript.length})`,
    );
  }

  const ts = now();
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs
      (player_strkey, player_pubkey_hex, transcript, proof_status, created_at, updated_at)
    VALUES
      (?, ?, ?, 'pending', ?, ?)
  `);
  const res = stmt.run(player_strkey, pubkey.toString("hex"), transcript, ts, ts);
  const runId = Number(res.lastInsertRowid);

  return Response.json({ run_id: runId, proof_status: "pending" as ProofStatus });
}

export function getRun(idStr: string): Response {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonError(400, "run id must be a positive integer");
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, player_strkey, player_pubkey_hex, proof_status, tx_hash, error, created_at, updated_at
         FROM runs WHERE id = ?`,
    )
    .get(id) as Omit<RunRow, "transcript" | "seal_hex" | "journal_hex"> | null;
  if (!row) return jsonError(404, `run #${id} not found`);
  return Response.json(row);
}
