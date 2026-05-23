import { PLANE_START_Y } from "./constants.js";
import { prngInit } from "./prng.js";
import type { GameState } from "./types.js";

export function createInitialState(seed: number): GameState {
  return {
    tick: 0,
    score: 0,
    gameOver: false,
    plane: { y: PLANE_START_Y, vy: 0 },
    pillars: [],
    nextPillarId: 1,
    rng: prngInit(seed),
  };
}
