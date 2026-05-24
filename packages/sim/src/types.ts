export interface PlayerInput {
  buttons: number;
}

export const BTN_UP = 1 << 0;
export const BTN_DOWN = 1 << 1;

export interface PRNGState {
  s: number;
}

export interface PlaneState {
  y: number;
  vy: number;
}

export interface Pillar {
  id: number;
  x: number;
  gapY: number;
  passed: boolean;
}

export const enum EnemyKind {
  BirdSmall = 0,
  BirdBig = 1,
  Drone = 2,
  Jet = 3,
  Ufo = 4,
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;       // px/tick, negative = moving left
  spawnTick: number; // used by UFO zigzag and per-enemy fire cadence
  spawnY: number;    // anchor for zigzag oscillation
  nextFireTick: number; // first tick at which this enemy may fire a missile
  passed: boolean;
}

export const enum MissileTier {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
}

export interface Missile {
  id: number;
  tier: MissileTier;
  frame: number; // index 0..11 into the missiles spritesheet
  x: number;
  y: number;
  vx: number;
}

export interface FuelToken {
  id: number;
  x: number;
  y: number;
}

export interface GameState {
  tick: number;
  score: number;
  gameOver: boolean;
  stage: number;            // index into STAGE_TABLE
  stageJustChanged: boolean; // transient per-tick render cue; not hashed
  fuel: number;             // 0..FUEL_MAX; ignored while stage.fuelEnabled === false
  plane: PlaneState;
  pillars: Pillar[];
  nextPillarId: number;
  enemies: Enemy[];
  nextEnemyId: number;
  missiles: Missile[];
  nextMissileId: number;
  fuelTokens: FuelToken[];
  nextFuelTokenId: number;
  rng: PRNGState;
}

export interface MatchConfig {
  worldWidth: number;
  worldHeight: number;
}
