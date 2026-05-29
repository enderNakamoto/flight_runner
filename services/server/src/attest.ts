// Attest-mode handler (Phase 13). Shells out to flight-replay for a
// native deterministic transcript replay, signs the resulting 76-byte
// journal with the configured operator key, and returns the triple the
// browser needs to call game_hub::settle_attested.
//
// Signed message layout (matches the contract):
//   game_id_le (4 bytes) || journal (76 bytes) = 80 bytes
// The game_id prefix stops a signed journal from being replayed against
// a different game on the same contract.

import { readFile } from "node:fs/promises";
import { Keypair } from "@stellar/stellar-sdk";
import { CONFIG } from "./config.ts";

// Cached at first use. Config-time validation already proved the
// strkey decodes; this just avoids re-parsing on every request.
let operatorKeypair: Keypair | null = null;
function getOperatorKeypair(): Keypair {
  if (!operatorKeypair) {
    operatorKeypair = Keypair.fromSecret(CONFIG.operatorSecretKey);
  }
  return operatorKeypair;
}

function jsonError(status: number, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export async function runAttest(
  playerStrkey: string,
  transcriptPath: string,
  proofPath: string,
): Promise<Response> {
  console.log(`[relay] attesting for ${playerStrkey}`);

  const proc = Bun.spawn({
    cmd: [
      CONFIG.flightReplayBin,
      transcriptPath,
      "--player",
      playerStrkey,
      "-o",
      proofPath,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  // Same live stderr tee as the ZK path — keeps the journal informative
  // even when a future flight-replay grows slow paths.
  const stderrChunks: Uint8Array[] = [];
  const stderrPump = (async () => {
    const reader = proc.stderr.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      stderrChunks.push(value);
      process.stderr.write(value);
    }
  })();

  const exitCode = await proc.exited;
  await stderrPump;
  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString();
    return jsonError(500, `flight-replay exited ${exitCode}: ${stderr.slice(-500)}`);
  }

  const artifacts = JSON.parse(await readFile(proofPath, "utf-8")) as {
    journal?: string;
    output?: { score?: number; ticks_survived?: number };
  };
  if (typeof artifacts.journal !== "string") {
    return jsonError(500, "flight-replay output missing journal");
  }

  const journal = Buffer.from(artifacts.journal, "hex");
  if (journal.length !== 76) {
    return jsonError(500, `attest journal must be 76 bytes, got ${journal.length}`);
  }

  // game_id_LE || journal — matches the contract's verify call.
  const msg = Buffer.alloc(80);
  msg.writeUInt32LE(CONFIG.gameId, 0);
  journal.copy(msg, 4);

  const sig = getOperatorKeypair().sign(msg);
  if (sig.length !== 64) {
    return jsonError(500, `ed25519 sig must be 64 bytes, got ${sig.length}`);
  }

  console.log(
    `[relay] ✅ attested score=${artifacts.output?.score ?? "?"} for ${playerStrkey}`,
  );
  return Response.json({
    ok: true,
    mode: "attest",
    game_id: CONFIG.gameId,
    journal_hex: artifacts.journal,
    signature_hex: sig.toString("hex"),
    score: artifacts.output?.score,
    ticks_survived: artifacts.output?.ticks_survived,
  });
}
