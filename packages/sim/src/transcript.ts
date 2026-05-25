// Run transcript = u32 seed (LE) || u8[ticks] buttons.
//
// One file == one run. The seed bootstraps the prng; each subsequent byte is
// the `buttons` value passed to stepMut on that tick. Replay is a pure
// function of (seed, buttons[]) → final GameState — the entire determinism
// guarantee of the sim is staked on this.

import { createInitialState } from "./state.js";
import { Stage } from "./stages.js";
import { stepMut } from "./step.js";
import type { GameState } from "./types.js";

export interface DecodedTranscript {
  seed: number;
  buttons: Uint8Array;
}

export interface ReplayResult {
  state: GameState;
  ticksConsumed: number;  // how many bytes we stepped before gameOver
}

export function encodeTranscript(seed: number, buttons: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + buttons.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, seed >>> 0, true); // little-endian — matches Rust default
  out.set(buttons, 4);
  return out;
}

export function decodeTranscript(buf: Uint8Array): DecodedTranscript {
  if (buf.length < 4) throw new Error(`transcript too short (${buf.length} bytes)`);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const seed = dv.getUint32(0, true);
  return { seed, buttons: buf.slice(4) };
}

/** Replay a transcript end-to-end. Stops as soon as state.gameOver flips, since
 *  subsequent steps are no-ops; returns the tick count we actually consumed. */
export function replay(buf: Uint8Array, startStage: Stage = Stage.Common): ReplayResult {
  const { seed, buttons } = decodeTranscript(buf);
  const state = createInitialState(seed, startStage);
  let i = 0;
  for (; i < buttons.length; i++) {
    stepMut(state, { buttons: buttons[i]! });
    if (state.gameOver) {
      i++;
      break;
    }
  }
  return { state, ticksConsumed: i };
}
