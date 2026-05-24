import {
  BIRD_BIG_DISPLAY_H,
  BIRD_BIG_DISPLAY_W,
  BIRD_BIG_HITBOX_H,
  BIRD_BIG_HITBOX_W,
  BIRD_SMALL_DISPLAY_H,
  BIRD_SMALL_DISPLAY_W,
  BIRD_SMALL_HITBOX_H,
  BIRD_SMALL_HITBOX_W,
  DRONE_DISPLAY_H,
  DRONE_DISPLAY_W,
  DRONE_FIRE_PERIOD_TICKS,
  DRONE_HITBOX_H,
  DRONE_HITBOX_W,
  DRONE_SCROLL_SPEED,
  ENEMY_SPAWN_X_MARGIN,
  ENEMY_SPAWN_Y_MAX,
  ENEMY_SPAWN_Y_MIN,
  FUEL_MAX,
  FUEL_PICKUP_AMOUNT,
  FUEL_TOKEN_DISPLAY,
  FUEL_TOKEN_HITBOX,
  FUEL_TOKEN_SCROLL_SPEED,
  JET_DISPLAY_H,
  JET_DISPLAY_W,
  JET_FIRE_PERIOD_TICKS,
  JET_HITBOX_H,
  JET_HITBOX_W,
  JET_SCROLL_SPEED,
  MISSILE_DISPLAY_H,
  MISSILE_DISPLAY_W,
  MISSILE_HITBOX_H,
  MISSILE_HITBOX_W,
  MISSILE_SPEED,
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
  UFO_DISPLAY_H,
  UFO_DISPLAY_W,
  UFO_HITBOX_H,
  UFO_HITBOX_W,
  UFO_SCROLL_SPEED,
  UFO_ZIGZAG_AMPLITUDE,
  UFO_ZIGZAG_PERIOD_TICKS,
  VERT_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "./constants.js";
import { prngNextU32, prngRange } from "./prng.js";
import {
  ENEMY_BIRD_BIG,
  ENEMY_BIRD_SMALL,
  ENEMY_DRONE,
  ENEMY_JET,
  ENEMY_UFO,
  MISSILE_COMMON,
  MISSILE_RARE,
  MISSILE_UNCOMMON,
  STAGE_TABLE,
  type StageParams,
} from "./stages.js";
import {
  BTN_DOWN,
  BTN_UP,
  EnemyKind,
  MissileTier,
  type Enemy,
  type GameState,
  type PlayerInput,
} from "./types.js";

interface EntityDims {
  hitboxW: number;
  hitboxH: number;
  displayW: number;
  displayH: number;
}

function enemyDims(kind: EnemyKind): EntityDims {
  switch (kind) {
    case EnemyKind.BirdSmall:
      return { hitboxW: BIRD_SMALL_HITBOX_W, hitboxH: BIRD_SMALL_HITBOX_H, displayW: BIRD_SMALL_DISPLAY_W, displayH: BIRD_SMALL_DISPLAY_H };
    case EnemyKind.BirdBig:
      return { hitboxW: BIRD_BIG_HITBOX_W, hitboxH: BIRD_BIG_HITBOX_H, displayW: BIRD_BIG_DISPLAY_W, displayH: BIRD_BIG_DISPLAY_H };
    case EnemyKind.Drone:
      return { hitboxW: DRONE_HITBOX_W, hitboxH: DRONE_HITBOX_H, displayW: DRONE_DISPLAY_W, displayH: DRONE_DISPLAY_H };
    case EnemyKind.Jet:
      return { hitboxW: JET_HITBOX_W, hitboxH: JET_HITBOX_H, displayW: JET_DISPLAY_W, displayH: JET_DISPLAY_H };
    case EnemyKind.Ufo:
      return { hitboxW: UFO_HITBOX_W, hitboxH: UFO_HITBOX_H, displayW: UFO_DISPLAY_W, displayH: UFO_DISPLAY_H };
  }
}

export function enemyDimsFor(kind: EnemyKind): EntityDims {
  return enemyDims(kind);
}

function enemyBaseSpeed(stage: StageParams, kind: EnemyKind): number {
  switch (kind) {
    case EnemyKind.BirdSmall: return stage.birdSmallSpeed;
    case EnemyKind.BirdBig:   return stage.birdBigSpeed;
    case EnemyKind.Drone:     return DRONE_SCROLL_SPEED;
    case EnemyKind.Jet:       return JET_SCROLL_SPEED;
    case EnemyKind.Ufo:       return UFO_SCROLL_SPEED;
  }
}

function fireCadenceForKind(kind: EnemyKind): number {
  return kind === EnemyKind.Jet ? JET_FIRE_PERIOD_TICKS : DRONE_FIRE_PERIOD_TICKS;
}

// Linear ramp: full bird weight at startScore, zero at endScore.
// Returns a value in [0, 1].
function birdSpawnWeight(stage: StageParams, score: number): number {
  if (stage.birdTaper === null) {
    return (stage.enemyMask & (ENEMY_BIRD_SMALL | ENEMY_BIRD_BIG)) !== 0 ? 1 : 0;
  }
  const { startScore, endScore } = stage.birdTaper;
  if (score <= startScore) return 1;
  if (score >= endScore) return 0;
  return (endScore - score) / (endScore - startScore);
}

function pickEnemyKind(stage: StageParams, score: number, rng: GameState["rng"]): EnemyKind | null {
  // Enabled kinds in this stage's mask, weighted equally except for the
  // bird taper applied to BirdSmall/BirdBig during Rare.
  const weighted: Array<{ kind: EnemyKind; w: number }> = [];
  const birdW = birdSpawnWeight(stage, score);
  if (stage.enemyMask & ENEMY_BIRD_SMALL) weighted.push({ kind: EnemyKind.BirdSmall, w: birdW });
  if (stage.enemyMask & ENEMY_BIRD_BIG)   weighted.push({ kind: EnemyKind.BirdBig,   w: birdW });
  if (stage.enemyMask & ENEMY_DRONE)      weighted.push({ kind: EnemyKind.Drone,     w: 1 });
  if (stage.enemyMask & ENEMY_JET)        weighted.push({ kind: EnemyKind.Jet,       w: 1 });
  if (stage.enemyMask & ENEMY_UFO)        weighted.push({ kind: EnemyKind.Ufo,       w: 0.4 }); // rarer

  let total = 0;
  for (const e of weighted) total += e.w;
  if (total <= 0) return null;

  // Use prng for the roll, mapped into [0, total).
  const r = (prngNextU32(rng) / 0x1_0000_0000) * total;
  let acc = 0;
  for (const e of weighted) {
    acc += e.w;
    if (r < acc) return e.kind;
  }
  return weighted[weighted.length - 1]!.kind;
}

function rollMissileFrame(tierMask: number, rng: GameState["rng"]): { tier: MissileTier; frame: number } | null {
  // Tier choice — pick the highest-tier bit available (weighted equally for now).
  const tiers: MissileTier[] = [];
  if (tierMask & MISSILE_COMMON)   tiers.push(MissileTier.Common);
  if (tierMask & MISSILE_UNCOMMON) tiers.push(MissileTier.Uncommon);
  if (tierMask & MISSILE_RARE)     tiers.push(MissileTier.Rare);
  if (tiers.length === 0) return null;
  const tier = tiers[prngNextU32(rng) % tiers.length]!;
  // Frames per tier — see public/assets/assets.json
  // Common: 0..5; Uncommon: 6..8; Rare: 9..11.
  let frame: number;
  if (tier === MissileTier.Common)   frame = prngNextU32(rng) % 6;
  else if (tier === MissileTier.Uncommon) frame = 6 + (prngNextU32(rng) % 3);
  else                               frame = 9 + (prngNextU32(rng) % 3);
  return { tier, frame };
}

function spawnEnemy(state: GameState, stage: StageParams): void {
  const kind = pickEnemyKind(stage, state.score, state.rng);
  if (kind === null) return;
  const dims = enemyDims(kind);
  const yMin = ENEMY_SPAWN_Y_MIN + dims.hitboxH / 2;
  const yMax = ENEMY_SPAWN_Y_MAX - dims.hitboxH / 2;
  const y = Math.floor(prngRange(state.rng, yMin, yMax));
  const speed = enemyBaseSpeed(stage, kind);
  const fireDelay = Math.floor(prngRange(state.rng, fireCadenceForKind(kind) / 2, fireCadenceForKind(kind) * 1.5));
  state.enemies.push({
    id: state.nextEnemyId++,
    kind,
    x: WORLD_WIDTH + ENEMY_SPAWN_X_MARGIN,
    y,
    vx: -speed,
    spawnTick: state.tick,
    spawnY: y,
    nextFireTick: state.tick + fireDelay,
    passed: false,
  });
}

function spawnFuelToken(state: GameState): void {
  const y = Math.floor(prngRange(state.rng, ENEMY_SPAWN_Y_MIN + 30, ENEMY_SPAWN_Y_MAX - 30));
  state.fuelTokens.push({
    id: state.nextFuelTokenId++,
    x: WORLD_WIDTH + ENEMY_SPAWN_X_MARGIN,
    y,
  });
}

function maybeFireMissiles(state: GameState, stage: StageParams): void {
  if (stage.missileTierMask === 0 || stage.missileMaxInFlight === 0) return;
  if (state.missiles.length >= stage.missileMaxInFlight) return;

  for (const e of state.enemies) {
    if (e.kind !== EnemyKind.Drone && e.kind !== EnemyKind.Jet) continue;
    if (e.x <= PLANE_X) continue; // only fire while still ahead of the plane
    if (state.tick < e.nextFireTick) continue;
    if (state.missiles.length >= stage.missileMaxInFlight) break;

    const choice = rollMissileFrame(stage.missileTierMask, state.rng);
    if (choice === null) continue;
    state.missiles.push({
      id: state.nextMissileId++,
      tier: choice.tier,
      frame: choice.frame,
      x: e.x - MISSILE_DISPLAY_W / 2,
      y: e.y,
      vx: -MISSILE_SPEED,
    });
    e.nextFireTick = state.tick + fireCadenceForKind(e.kind);
  }
}

export function stepMut(state: GameState, input: PlayerInput): void {
  if (state.gameOver) return;

  state.tick++;
  state.stageJustChanged = false;

  // ---- Plane vertical steering ----
  let dy = 0;
  if ((input.buttons & BTN_UP) !== 0) dy -= VERT_SPEED;
  if ((input.buttons & BTN_DOWN) !== 0) dy += VERT_SPEED;
  state.plane.vy = dy;
  state.plane.y += dy;

  if (state.plane.y < 0 || state.plane.y > WORLD_HEIGHT) {
    state.gameOver = true;
    return;
  }

  const stage = STAGE_TABLE[state.stage]!;

  // ---- Fuel drain + fuel-out ----
  if (stage.fuelEnabled) {
    state.fuel -= stage.fuelDrainPerTick;
    if (state.fuel <= 0) {
      state.fuel = 0;
      state.gameOver = true;
      return;
    }
  }

  // ---- Spawn: pillars, enemies, missiles (from enemies), fuel tokens ----
  if (stage.pillarsEnabled && state.tick % PILLAR_SPAWN_PERIOD_TICKS === 0) {
    const gapY = Math.floor(prngRange(state.rng, PILLAR_GAP_MIN_Y, PILLAR_GAP_MAX_Y));
    state.pillars.push({
      id: state.nextPillarId++,
      x: WORLD_WIDTH + PILLAR_WIDTH,
      gapY,
      passed: false,
    });
  }
  if (stage.enemySpawnPeriod > 0 && state.tick % stage.enemySpawnPeriod === 0) {
    spawnEnemy(state, stage);
  }
  if (stage.fuelEnabled && stage.fuelSpawnPeriod > 0 && state.tick % stage.fuelSpawnPeriod === 0) {
    spawnFuelToken(state);
  }
  maybeFireMissiles(state, stage);

  // ---- Plane hitbox (once per tick) ----
  const planeLeft = PLANE_X - PLANE_HITBOX_W / 2;
  const planeRight = PLANE_X + PLANE_HITBOX_W / 2;
  const planeTop = state.plane.y - PLANE_HITBOX_H / 2;
  const planeBottom = state.plane.y + PLANE_HITBOX_H / 2;

  // ---- Pillars ----
  const pillarInsetX = (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2;
  for (const p of state.pillars) {
    p.x -= PILLAR_SCROLL_SPEED;
    if (!p.passed && p.x + PILLAR_WIDTH < PLANE_X) {
      p.passed = true;
      state.score++;
    }
    const pillarLeft = p.x + pillarInsetX;
    const pillarRight = p.x + PILLAR_WIDTH - pillarInsetX;
    if (planeRight > pillarLeft && planeLeft < pillarRight) {
      const visGapTop = p.gapY - PILLAR_GAP / 2;
      const visGapBottom = p.gapY + PILLAR_GAP / 2;
      const topPillarH = visGapTop;
      const botPillarH = WORLD_HEIGHT - visGapBottom;
      const topInset = (topPillarH * PILLAR_TOP_GAP_PAD_SRC) / PILLAR_SRC_H;
      const botInset = (botPillarH * PILLAR_BOT_GAP_PAD_SRC) / PILLAR_SRC_H;
      const hitGapTop = visGapTop - topInset;
      const hitGapBottom = visGapBottom + botInset;
      if (planeTop < hitGapTop || planeBottom > hitGapBottom) {
        state.gameOver = true;
        return;
      }
    }
  }
  if (state.pillars.length > 0 && state.pillars[0]!.x + PILLAR_WIDTH < 0) {
    state.pillars.shift();
  }

  // ---- Enemies ----
  for (const e of state.enemies) {
    if (e.kind === EnemyKind.Ufo) {
      // Zigzag — vy oscillates as a deterministic sin of (tick - spawnTick).
      const phase = ((state.tick - e.spawnTick) / UFO_ZIGZAG_PERIOD_TICKS) * Math.PI * 2;
      e.y = e.spawnY + Math.sin(phase) * UFO_ZIGZAG_AMPLITUDE;
    }
    e.x += e.vx;

    const dims = enemyDims(e.kind);
    if (!e.passed && e.x + dims.hitboxW / 2 < PLANE_X) {
      e.passed = true;
      // UFO is worth more — it's the boss tier.
      state.score += e.kind === EnemyKind.Ufo ? 5 : 1;
    }

    const eLeft = e.x - dims.hitboxW / 2;
    const eRight = e.x + dims.hitboxW / 2;
    const eTop = e.y - dims.hitboxH / 2;
    const eBottom = e.y + dims.hitboxH / 2;
    if (planeRight > eLeft && planeLeft < eRight && planeBottom > eTop && planeTop < eBottom) {
      state.gameOver = true;
      return;
    }
  }
  state.enemies = state.enemies.filter((e) => e.x + enemyDims(e.kind).hitboxW / 2 > 0);

  // ---- Missiles ----
  for (const m of state.missiles) {
    m.x += m.vx;
    const mLeft = m.x - MISSILE_HITBOX_W / 2;
    const mRight = m.x + MISSILE_HITBOX_W / 2;
    const mTop = m.y - MISSILE_HITBOX_H / 2;
    const mBottom = m.y + MISSILE_HITBOX_H / 2;
    if (planeRight > mLeft && planeLeft < mRight && planeBottom > mTop && planeTop < mBottom) {
      state.gameOver = true;
      return;
    }
  }
  state.missiles = state.missiles.filter((m) => m.x + MISSILE_HITBOX_W / 2 > 0);

  // ---- Fuel tokens ----
  if (stage.fuelEnabled) {
    for (const t of state.fuelTokens) {
      t.x -= FUEL_TOKEN_SCROLL_SPEED;
    }
    state.fuelTokens = state.fuelTokens.filter((t) => {
      if (t.x + FUEL_TOKEN_HITBOX / 2 < 0) return false;
      const tLeft = t.x - FUEL_TOKEN_HITBOX / 2;
      const tRight = t.x + FUEL_TOKEN_HITBOX / 2;
      const tTop = t.y - FUEL_TOKEN_HITBOX / 2;
      const tBottom = t.y + FUEL_TOKEN_HITBOX / 2;
      const collide = planeRight > tLeft && planeLeft < tRight && planeBottom > tTop && planeTop < tBottom;
      if (collide) {
        state.fuel = Math.min(FUEL_MAX, state.fuel + FUEL_PICKUP_AMOUNT);
        state.score++;
        return false; // remove on pickup
      }
      return true;
    });
  } else if (state.fuelTokens.length > 0) {
    state.fuelTokens.length = 0;
  }

  // ---- Stage advancement ----
  const nextIdx = state.stage + 1;
  if (nextIdx < STAGE_TABLE.length && state.score >= STAGE_TABLE[nextIdx]!.scoreGate) {
    state.stage = nextIdx;
    state.stageJustChanged = true;
  }
}

export { enemyDims as enemyDimsForKind };
export type { Enemy };
