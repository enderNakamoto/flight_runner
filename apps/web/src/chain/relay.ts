// Relay HTTP client — one call: POST /api/prove. The relay runs
// flight-host and returns the proof artifacts; it does NOT touch the
// chain. The browser's wallet signs and submits submit_score itself.

import { CONFIG } from "./config.js";

export interface ProveOk {
  ok: true;
  seal_hex: string;
  journal_hex: string;
  score?: number;
  ticks_survived?: number;
}
export interface ProveErr {
  ok: false;
  error: string;
}
export type ProveResult = ProveOk | ProveErr;

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

export async function proveTranscript(
  playerStrkey: string,
  transcript: Uint8Array,
): Promise<ProveResult> {
  const url = `${requireRelayUrl()}/api/prove`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      player_strkey: playerStrkey,
      transcript_b64: bytesToBase64(transcript),
    }),
  });
  return (await res.json()) as ProveResult;
}
