import {
  PILLAR_GAP,
  PILLAR_GAP_MAX_Y,
  PILLAR_GAP_MIN_Y,
  PILLAR_SCROLL_SPEED,
  PILLAR_SPAWN_PERIOD_TICKS,
  PILLAR_WIDTH,
  PLANE_HITBOX_H,
  PLANE_HITBOX_W,
  PLANE_X,
  VERT_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants.js";
import { prngRange } from "./prng.js";
import { BTN_DOWN, BTN_UP, type GameState, type PlayerInput } from "./types.js";

export function stepMut(state: GameState, input: PlayerInput): void {
  if (state.gameOver) return;

  state.tick++;

  let dy = 0;
  if ((input.buttons & BTN_UP) !== 0) dy -= VERT_SPEED;
  if ((input.buttons & BTN_DOWN) !== 0) dy += VERT_SPEED;
  state.plane.vy = dy;
  state.plane.y += dy;

  if (state.plane.y < 0 || state.plane.y > WORLD_HEIGHT) {
    state.gameOver = true;
    return;
  }

  if (state.tick % PILLAR_SPAWN_PERIOD_TICKS === 0) {
    const gapY = Math.floor(prngRange(state.rng, PILLAR_GAP_MIN_Y, PILLAR_GAP_MAX_Y));
    state.pillars.push({
      id: state.nextPillarId++,
      x: WORLD_WIDTH + PILLAR_WIDTH,
      gapY,
      passed: false,
    });
  }

  const planeLeft = PLANE_X - PLANE_HITBOX_W / 2;
  const planeRight = PLANE_X + PLANE_HITBOX_W / 2;
  const planeTop = state.plane.y - PLANE_HITBOX_H / 2;
  const planeBottom = state.plane.y + PLANE_HITBOX_H / 2;

  for (const p of state.pillars) {
    p.x -= PILLAR_SCROLL_SPEED;

    if (!p.passed && p.x + PILLAR_WIDTH < PLANE_X) {
      p.passed = true;
      state.score++;
    }

    const pillarLeft = p.x;
    const pillarRight = p.x + PILLAR_WIDTH;
    if (planeRight > pillarLeft && planeLeft < pillarRight) {
      const gapTop = p.gapY - PILLAR_GAP / 2;
      const gapBottom = p.gapY + PILLAR_GAP / 2;
      if (planeTop < gapTop || planeBottom > gapBottom) {
        state.gameOver = true;
        return;
      }
    }
  }

  if (state.pillars.length > 0 && state.pillars[0]!.x + PILLAR_WIDTH < 0) {
    state.pillars.shift();
  }
}
