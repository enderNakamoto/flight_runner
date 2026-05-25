export interface PlayerInput {
  buttons: number;
}

export const BTN_UP = 1 << 0;
export const BTN_DOWN = 1 << 1;
export const BTN_LEFT = 1 << 2;
export const BTN_RIGHT = 1 << 3;

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
  BannerPlane = 5,
}

export const enum GameOverReason {
  Unknown = 0,
  Bird = 1,
  Drone = 2,
  Jet = 3,
  Ufo = 4,
  Missile = 5,
  Pillar = 6,
  WorldTop = 7,
  WorldBottom = 8,
  FuelOut = 9,
  BannerPlane = 10,
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
  gameOverReason: GameOverReason;
  stage: number;            // index into STAGE_TABLE
  stageJustChanged: boolean; // transient per-tick render cue; not hashed
  fuel: number;             // Q24.8 in 0..fp(FUEL_MAX); ignored while !stage.fuelEnabled
  worldSpeedMul: number;    // Q24.8 horizontal-motion multiplier (fp(0.5) / fp(1) / fp(3) by input)
  worldDistance: number;    // Q24.8 — accumulated worldSpeedMul; spawn cadence + bg parallax gate on this
  nextPillarDistance: number;  // Q24.8
  nextEnemyDistance: number;   // Q24.8
  nextFuelDistance: number;    // Q24.8
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
