// State serializer — packs the persistent fields of GameState into a fixed
// byte layout so two sims (TS↔TS today, TS↔Rust later) can be compared
// byte-for-byte at any tick. Caller hashes externally (e.g. SHA-256) to get
// a per-tick state digest for the parity test.
//
// Format: little-endian throughout, all numeric fields are 4-byte ints/u32.
// Booleans and small enums are bit-packed into u32s. Lists are prefixed by
// a u32 length.
//
// As of Phase 3, the entire sim runs in Q24.8 i32 — positions, velocities,
// fuel, world distance are already pre-shifted in state. The serializer
// just writes them via wI32, no extra conversion.
//
// NOT serialized: stageJustChanged (transient render cue), worldSpeedMul
// (deterministically derived from input — redundant).

import type { GameState } from "./types.js";

export const SER_HEADER_BYTES = 15 * 4;   // 15 fixed-width fields
export const SER_PILLAR_BYTES = 16;
export const SER_ENEMY_BYTES = 32;
export const SER_MISSILE_BYTES = 20;
export const SER_TOKEN_BYTES = 12;

export function serializedSize(state: GameState): number {
  return SER_HEADER_BYTES
    + 4 + state.pillars.length    * SER_PILLAR_BYTES
    + 4 + state.enemies.length    * SER_ENEMY_BYTES
    + 4 + state.missiles.length   * SER_MISSILE_BYTES
    + 4 + state.fuelTokens.length * SER_TOKEN_BYTES;
}

export function serializeState(state: GameState, reuse?: Uint8Array): Uint8Array {
  const size = serializedSize(state);
  const buf = reuse && reuse.byteLength >= size
    ? new Uint8Array(reuse.buffer, reuse.byteOffset, size)
    : new Uint8Array(size);
  const dv = new DataView(buf.buffer, buf.byteOffset, size);
  let p = 0;
  const wU32 = (v: number) => { dv.setUint32(p, v >>> 0, true); p += 4; };
  const wI32 = (v: number) => { dv.setInt32(p, v | 0, true); p += 4; };

  // Header
  wU32(state.tick);
  wU32(state.score);
  wU32(
    (state.gameOver ? 1 : 0)
    | ((state.gameOverReason & 0xff) << 8)
    | ((state.stage & 0xff) << 16),
  );
  wI32(state.fuel);
  wI32(state.worldDistance);
  wI32(state.nextPillarDistance);
  wI32(state.nextEnemyDistance);
  wI32(state.nextFuelDistance);
  wI32(state.plane.y);
  wI32(state.plane.vy);
  wU32(state.rng.s);
  wU32(state.nextPillarId);
  wU32(state.nextEnemyId);
  wU32(state.nextMissileId);
  wU32(state.nextFuelTokenId);

  // Pillars
  wU32(state.pillars.length);
  for (const pil of state.pillars) {
    wU32(pil.id);
    wI32(pil.x);
    wI32(pil.gapY);
    wU32(pil.passed ? 1 : 0);
  }

  // Enemies
  wU32(state.enemies.length);
  for (const e of state.enemies) {
    wU32(e.id);
    wU32((e.kind & 0xff) | ((e.passed ? 1 : 0) << 8));
    wU32(e.spawnTick);
    wU32(e.nextFireTick);
    wI32(e.x);
    wI32(e.y);
    wI32(e.vx);
    wI32(e.spawnY);
  }

  // Missiles
  wU32(state.missiles.length);
  for (const m of state.missiles) {
    wU32(m.id);
    wU32((m.tier & 0xff) | ((m.frame & 0xff) << 8));
    wI32(m.x);
    wI32(m.y);
    wI32(m.vx);
  }

  // Fuel tokens
  wU32(state.fuelTokens.length);
  for (const t of state.fuelTokens) {
    wU32(t.id);
    wI32(t.x);
    wI32(t.y);
  }

  return buf;
}
