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

export interface GameState {
  tick: number;
  score: number;
  gameOver: boolean;
  plane: PlaneState;
  pillars: Pillar[];
  nextPillarId: number;
  rng: PRNGState;
}

export interface MatchConfig {
  worldWidth: number;
  worldHeight: number;
}
