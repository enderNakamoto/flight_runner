// POST /api/submit-score — the only endpoint.
//
// Synchronous: spawn flight-host on the player's transcript, wait for
// proof_artifacts.json, call submit_score on chain, return the tx hash.
// Whole request takes minutes; HTTP keep-alive holds it. If the client
// disconnects mid-flight, the relay still finishes — the score lands
// on chain regardless and the player just refreshes get_score.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { submitScore } from "./chain.ts";
import { CONFIG } from "./config.ts";

const MAX_TRANSCRIPT_BYTES = 64 * 1024;

const lastSubmitByPubkey = new Map<string, number>();

function jsonError(status: number, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export async function handleSubmitScore(req: Request): Promise<Response> {
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

  let pubkeyHex: string;
  try {
    pubkeyHex = Buffer.from(StrKey.decodeEd25519PublicKey(player_strkey)).toString("hex");
  } catch {
    return jsonError(400, "player_strkey is not a valid Stellar G… address");
  }

  const now = Date.now();
  const lastAt = lastSubmitByPubkey.get(pubkeyHex);
  if (lastAt && now - lastAt < CONFIG.submitCooldownSeconds * 1000) {
    const wait = Math.ceil((CONFIG.submitCooldownSeconds * 1000 - (now - lastAt)) / 1000);
    return jsonError(429, `cooldown — wait ${wait}s before submitting again`);
  }
  lastSubmitByPubkey.set(pubkeyHex, now);

  let transcript: Buffer;
  try {
    transcript = Buffer.from(transcript_b64, "base64");
  } catch {
    return jsonError(400, "transcript_b64 is not valid base64");
  }
  if (transcript.length < 4) return jsonError(400, "transcript too short");
  if (transcript.length > MAX_TRANSCRIPT_BYTES) {
    return jsonError(413, `transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`);
  }

  const workDir = await mkdir(join(tmpdir(), `flight-relay-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
  const dir = workDir!;
  const transcriptPath = join(dir, "transcript.bin");
  const proofPath = join(dir, "proof_artifacts.json");

  try {
    await writeFile(transcriptPath, transcript);
    console.log(`[relay] proving for ${player_strkey} (${transcript.length} bytes)`);

    const proc = Bun.spawn({
      cmd: [
        CONFIG.flightHostBin,
        transcriptPath,
        "--player",
        player_strkey,
        "-o",
        proofPath,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return jsonError(500, `flight-host exited ${exitCode}: ${stderr.slice(-500)}`);
    }

    const artifacts = JSON.parse(await readFile(proofPath, "utf-8")) as {
      seal?: string;
      journal?: string;
      output?: { score?: number; ticks_survived?: number };
    };
    if (typeof artifacts.seal !== "string" || typeof artifacts.journal !== "string") {
      return jsonError(500, "flight-host output missing seal/journal");
    }

    console.log(`[relay] submitting on-chain for ${player_strkey} …`);
    const submit = await submitScore(CONFIG.gameId, artifacts.seal, artifacts.journal);
    if (!submit.ok) {
      return jsonError(502, `submit_score failed: ${submit.error}`);
    }
    console.log(`[relay] ✅ tx ${submit.txHash} for ${player_strkey}`);
    return Response.json({
      ok: true,
      tx_hash: submit.txHash,
      score: artifacts.output?.score,
      ticks_survived: artifacts.output?.ticks_survived,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return jsonError(500, m);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
