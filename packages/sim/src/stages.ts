// Stage system — see spec/architecture.md §4.
//
// Phase 2a wires up the table and the Common→Uncommon transition; only
// bird spawning + pillars-gating are exercised so far. Drone/jet/UFO/missile
// fields are kept on the type so later phases can extend without reshaping the
// table.
//
// Values are plain floats for now; they will move to Q24.8 fixed-point in
// Phase 3 (Rust port + parity test).

export const enum Stage {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Legendary = 3,
  Mythical = 4,
}

// enemy bitmask bits
export const ENEMY_BIRD_SMALL = 1 << 0;
export const ENEMY_BIRD_BIG = 1 << 1;
export const ENEMY_DRONE = 1 << 2;
export const ENEMY_JET = 1 << 3;
export const ENEMY_UFO = 1 << 4;

// missile tier bitmask bits
export const MISSILE_COMMON = 1 << 0;
export const MISSILE_UNCOMMON = 1 << 1;
export const MISSILE_RARE = 1 << 2;

export interface StageParams {
  scoreGate: number;
  pillarsEnabled: boolean;
  pillarSpawnPeriod: number;  // distance units between pillars (0 disables)
  pillarGap: number;
  scrollSpeed: number;
  fuelEnabled: boolean;
  fuelDrainPerTick: number;
  fuelSpawnPeriod: number;    // distance units between fuel tokens
  enemySpawnPeriod: number;   // distance units between enemy rolls
  enemyMask: number;
  birdTaper: { startScore: number; endScore: number } | null;
  birdSmallSpeed: number;
  birdBigSpeed: number;
  missileTierMask: number;
  missileMaxInFlight: number;
  visibilityFlicker: boolean;
}

export const STAGE_TABLE: readonly StageParams[] = [
  /* Common */ {
    scoreGate: 0,
    pillarsEnabled: false,
    pillarSpawnPeriod: 0,
    pillarGap: 0,
    scrollSpeed: 2.0,
    fuelEnabled: false,
    fuelDrainPerTick: 0,
    fuelSpawnPeriod: 0,
    enemySpawnPeriod: 180,
    enemyMask: ENEMY_BIRD_SMALL,
    birdTaper: null,
    birdSmallSpeed: 3.6,
    birdBigSpeed: 0,
    missileTierMask: 0,
    missileMaxInFlight: 0,
    visibilityFlicker: false,
  },
  /* Uncommon */ {
    scoreGate: 12,
    pillarsEnabled: false,
    pillarSpawnPeriod: 0,
    pillarGap: 0,
    scrollSpeed: 2.1,
    fuelEnabled: true,
    fuelDrainPerTick: 0.04,
    fuelSpawnPeriod: 320,
    enemySpawnPeriod: 150,
    enemyMask: ENEMY_BIRD_SMALL | ENEMY_BIRD_BIG,
    birdTaper: null,
    birdSmallSpeed: 4.4,
    birdBigSpeed: 2.6,
    missileTierMask: 0,
    missileMaxInFlight: 0,
    visibilityFlicker: false,
  },
  /* Rare */ {
    scoreGate: 37,
    pillarsEnabled: true,
    pillarSpawnPeriod: 440,
    pillarGap: 220,
    scrollSpeed: 2.3,
    fuelEnabled: true,
    fuelDrainPerTick: 0.05,
    fuelSpawnPeriod: 340,
    enemySpawnPeriod: 220,
    enemyMask: ENEMY_BIRD_SMALL | ENEMY_BIRD_BIG | ENEMY_DRONE,
    birdTaper: { startScore: 37, endScore: 125 },
    birdSmallSpeed: 4.4,
    birdBigSpeed: 2.6,
    missileTierMask: MISSILE_COMMON,
    missileMaxInFlight: 1,
    visibilityFlicker: false,
  },
  /* Legendary */ {
    scoreGate: 125,
    pillarsEnabled: true,
    pillarSpawnPeriod: 380,
    pillarGap: 200,
    scrollSpeed: 2.5,
    fuelEnabled: true,
    fuelDrainPerTick: 0.06,
    fuelSpawnPeriod: 450,
    enemySpawnPeriod: 180,
    enemyMask: ENEMY_DRONE | ENEMY_JET,
    birdTaper: null,
    birdSmallSpeed: 0,
    birdBigSpeed: 0,
    missileTierMask: MISSILE_COMMON | MISSILE_UNCOMMON,
    missileMaxInFlight: 2,
    visibilityFlicker: false,
  },
  /* Mythical */ {
    scoreGate: 300,
    pillarsEnabled: true,
    pillarSpawnPeriod: 320,
    pillarGap: 180,
    scrollSpeed: 2.7,
    fuelEnabled: true,
    fuelDrainPerTick: 0.07,
    fuelSpawnPeriod: 700,
    enemySpawnPeriod: 140,
    enemyMask: ENEMY_DRONE | ENEMY_JET | ENEMY_UFO,
    birdTaper: null,
    birdSmallSpeed: 0,
    birdBigSpeed: 0,
    missileTierMask: MISSILE_COMMON | MISSILE_UNCOMMON | MISSILE_RARE,
    missileMaxInFlight: 3,
    visibilityFlicker: true,
  },
];

export const STAGE_NAMES = ["COMMON", "UNCOMMON", "RARE", "LEGENDARY", "MYTHICAL"] as const;

export function stageForScore(score: number): Stage {
  for (let i = STAGE_TABLE.length - 1; i >= 0; i--) {
    if (score >= STAGE_TABLE[i]!.scoreGate) return i as Stage;
  }
  return Stage.Common;
}
