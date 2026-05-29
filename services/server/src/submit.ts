// POST /api/prove — the only endpoint.
//
// Pure prover: spawn flight-host on the player's transcript, wait for
// proof_artifacts.json, return { seal_hex, journal_hex } to the caller.
// The relay never touches the chain — the browser's wallet signs and
// submits the on-chain submit_score.
//
// Whole request takes minutes (5–25 min for a real Groth16 wrap).
// HTTP keep-alive holds it. If the client disconnects mid-flight, the
// process still finishes; the player just has to re-submit.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { CONFIG } from "./config.ts";

const MAX_TRANSCRIPT_BYTES = 64 * 1024;

const lastSubmitByPubkey = new Map<string, number>();

function jsonError(status: number, message: string): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export async function handleProve(req: Request): Promise<Response> {
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

  const dir = await mkdir(
    join(tmpdir(), `flight-relay-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    { recursive: true },
  );
  if (!dir) throw new Error("mkdir returned undefined");
  const transcriptPath = join(dir, "transcript.bin");
  const proofPath = join(dir, "proof_artifacts.json");

  try {
    await writeFile(transcriptPath, transcript);
    console.log(`[relay] proving for ${player_strkey} (${transcript.length} bytes)`);

    const modeFlag: string[] =
      CONFIG.proveMode === "stub" ? ["--stub-seal"] :
      CONFIG.proveMode === "stark" ? ["--local"] :
      [];
    const proc = Bun.spawn({
      cmd: [
        CONFIG.flightHostBin,
        transcriptPath,
        "--player",
        player_strkey,
        ...modeFlag,
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

    // Real-Groth16 mode: prepend the on-chain verifier's selector to
    // the bare SNARK so the resulting 260-byte seal carries the right
    // version tag. Stub mode keeps its 260 zero bytes — MockVerifier
    // doesn't selector-check anyway.
    let sealHex = artifacts.seal;
    if (CONFIG.proveMode !== "stub" && CONFIG.verifierSelectorHex) {
      const sel = CONFIG.verifierSelectorHex.replace(/^0x/, "").toLowerCase();
      if (sel.length !== 8) {
        return jsonError(500, "VERIFIER_SELECTOR_HEX must be 4 bytes (8 hex chars)");
      }
      // flight-host's groth16 output is the 256-byte Groth16 proof.
      // Strip a leading selector if it's already present (256 vs 260),
      // then prepend the one matching our deployed verifier.
      if (sealHex.length === 520) {
        sealHex = sealHex.slice(8);
      }
      sealHex = sel + sealHex;
    }

    const sealBytes = sealHex.length / 2;
    if (CONFIG.proveMode === "groth16" && sealBytes !== 260) {
      return jsonError(
        500,
        `groth16 seal must be exactly 260 bytes, got ${sealBytes} — prover misconfigured`,
      );
    }

    console.log(
      `[relay] ✅ proved score=${artifacts.output?.score ?? "?"} for ${player_strkey} (seal ${sealHex.length / 2} bytes)`,
    );
    return Response.json({
      ok: true,
      seal_hex: sealHex,
      journal_hex: artifacts.journal,
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
