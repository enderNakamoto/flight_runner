import {
  PILLAR_BOT_GAP_PAD_SRC,
  PILLAR_GAP,
  PILLAR_GAP_MAX_Y,
  PILLAR_GAP_MIN_Y,
  PILLAR_HITBOX_W,
  PILLAR_SCROLL_SPEED,
  PILLAR_SPAWN_PERIOD_TICKS,
  PILLAR_SRC_H,
  PILLAR_TOP_GAP_PAD_SRC,
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

  const hitInsetX = (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2;
  for (const p of state.pillars) {
    p.x -= PILLAR_SCROLL_SPEED;

    if (!p.passed && p.x + PILLAR_WIDTH < PLANE_X) {
      p.passed = true;
      state.score++;
    }

    const pillarLeft = p.x + hitInsetX;
    const pillarRight = p.x + PILLAR_WIDTH - hitInsetX;
    if (planeRight > pillarLeft && planeLeft < pillarRight) {
      // Per-pillar gap insets scale with the stretched sprite, matching the
      // cloud's transparent padding near the gap edge.
      const visGapTop = p.gapY - PILLAR_GAP / 2;
      const visGapBottom = p.gapY + PILLAR_GAP / 2;
      const topPillarH = visGapTop;
      const botPillarH = WORLD_HEIGHT - visGapBottom;
      const topInset = (topPillarH * PILLAR_TOP_GAP_PAD_SRC) / PILLAR_SRC_H;
      const botInset = (botPillarH * PILLAR_BOT_GAP_PAD_SRC) / PILLAR_SRC_H;
      const hitGapTop = visGapTop - topInset;       // hitbox of top cloud ends here (above the visual gap edge)
      const hitGapBottom = visGapBottom + botInset; // hitbox of bottom cloud starts here (below the visual gap edge)
      if (planeTop < hitGapTop || planeBottom > hitGapBottom) {
        state.gameOver = true;
        return;
      }
    }
  }

  if (state.pillars.length > 0 && state.pillars[0]!.x + PILLAR_WIDTH < 0) {
    state.pillars.shift();
  }
}
