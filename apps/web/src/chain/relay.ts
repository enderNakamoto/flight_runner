// Relay HTTP client — one call: POST /api/submit-score. Synchronous-ish:
// the request stays open while the relay proves + submits. Returns the
// on-chain tx hash on success or a structured error.

import { CONFIG } from "./config.js";

export interface SubmitOk {
  ok: true;
  tx_hash: string;
  score?: number;
  ticks_survived?: number;
}
export interface SubmitErr {
  ok: false;
  error: string;
}
export type SubmitResult = SubmitOk | SubmitErr;

function requireRelayUrl(): string {
  if (!CONFIG.relayUrl) {
    throw new Error("VITE_RELAY_URL is not set");
  }
  return CONFIG.relayUrl.replace(/\/$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export async function submitScore(
  playerStrkey: string,
  transcript: Uint8Array,
): Promise<SubmitResult> {
  const url = `${requireRelayUrl()}/api/submit-score`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      player_strkey: playerStrkey,
      transcript_b64: bytesToBase64(transcript),
    }),
  });
  const json = (await res.json()) as SubmitResult;
  return json;
}
