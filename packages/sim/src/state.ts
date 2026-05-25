import { FUEL_INITIAL, PLANE_START_Y } from "./constants.js";
import { fp } from "./fp.js";
import { prngInit } from "./prng.js";
import { Stage } from "./stages.js";
import { GameOverReason, type GameState } from "./types.js";

export function createInitialState(seed: number, startStage: Stage = Stage.Common): GameState {
  return {
    tick: 0,
    score: 0,
    gameOver: false,
    gameOverReason: GameOverReason.Unknown,
    stage: startStage,
    stageJustChanged: false,
    fuel: fp(FUEL_INITIAL),
    worldSpeedMul: fp(1),
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
