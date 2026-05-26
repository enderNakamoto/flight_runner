// Relay HTTP client — matches services/server/src/routes/public.ts.

import { CONFIG } from "./config.js";

export type ProofStatus = "pending" | "proving" | "settled" | "failed";

export interface RunStatus {
  id: number;
  player_strkey: string;
  proof_status: ProofStatus;
  tx_hash: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function requireRelayUrl(): string {
  if (!CONFIG.relayUrl) {
    throw new Error("VITE_RELAY_URL is not set — relay flow disabled");
  }
  return CONFIG.relayUrl.replace(/\/$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export async function submitRun(
  playerStrkey: string,
  transcript: Uint8Array,
): Promise<{ run_id: number; proof_status: ProofStatus }> {
  const url = `${requireRelayUrl()}/api/runs`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      player_strkey: playerStrkey,
      transcript_b64: bytesToBase64(transcript),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`relay POST /api/runs failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getRunStatus(runId: number): Promise<RunStatus> {
  const url = `${requireRelayUrl()}/api/runs/${runId}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`relay GET /api/runs/${runId} failed (${res.status}): ${text}`);
  }
  return res.json();
}
