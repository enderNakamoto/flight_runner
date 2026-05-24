import { FUEL_INITIAL, PLANE_START_Y } from "./constants.js";
import { prngInit } from "./prng.js";
import { Stage } from "./stages.js";
import type { GameState } from "./types.js";

export function createInitialState(seed: number, startStage: Stage = Stage.Common): GameState {
  return {
    tick: 0,
    score: 0,
    gameOver: false,
    stage: startStage,
    stageJustChanged: false,
    fuel: FUEL_INITIAL,
    worldSpeedMul: 1,
    worldDistance: 0,
    nextPillarDistance: 0,
    nextEnemyDistance: 0,
    nextFuelDistance: 0,
    plane: { y: PLANE_START_Y, vy: 0 },
    pillars: [],
    nextPillarId: 1,
    enemies: [],
    nextEnemyId: 1,
    missiles: [],
    nextMissileId: 1,
    fuelTokens: [],
    nextFuelTokenId: 1,
    rng: prngInit(seed),
  };
}
