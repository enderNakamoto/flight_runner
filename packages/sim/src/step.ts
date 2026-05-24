import {
  BANNER_PLANE_DISPLAY_H,
  BANNER_PLANE_DISPLAY_W,
  BANNER_PLANE_HITBOX_H,
  BANNER_PLANE_HITBOX_W,
  BANNER_PLANE_SCROLL_SPEED,
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
  PILLAR_SRC_H,
  PILLAR_TOP_GAP_PAD_SRC,
  PILLAR_WIDTH,
  PLANE_HITBOX_PARTS,
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
  ENEMY_BANNER_PLANE,
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
  BTN_LEFT,
  BTN_RIGHT,
  BTN_UP,
  EnemyKind,
  GameOverReason,
  MissileTier,
  type Enemy,
  type GameState,
  type PlayerInput,
} from "./types.js";

function reasonForEnemy(kind: EnemyKind): GameOverReason {
  switch (kind) {
    case EnemyKind.BirdSmall:
    case EnemyKind.BirdBig:
      return GameOverReason.Bird;
    case EnemyKind.Drone:
      return GameOverReason.Drone;
    case EnemyKind.Jet:
      return GameOverReason.Jet;
    case EnemyKind.Ufo:
      return GameOverReason.Ufo;
    case EnemyKind.BannerPlane:
      return GameOverReason.BannerPlane;
  }
}

const SPEED_SLOW = 0.5;
const SPEED_FAST = 3.0;

function computeSpeedMul(buttons: number): number {
  const left = (buttons & BTN_LEFT) !== 0;
  const right = (buttons & BTN_RIGHT) !== 0;
  if (left && !right) return SPEED_SLOW;
  if (right && !left) return SPEED_FAST;
  return 1;
}

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
    case EnemyKind.BannerPlane:
      return { hitboxW: BANNER_PLANE_HITBOX_W, hitboxH: BANNER_PLANE_HITBOX_H, displayW: BANNER_PLANE_DISPLAY_W, displayH: BANNER_PLANE_DISPLAY_H };
  }
}

export function enemyDimsFor(kind: EnemyKind): EntityDims {
  return enemyDims(kind);
}

function enemyBaseSpeed(stage: StageParams, kind: EnemyKind): number {
  switch (kind) {
    case EnemyKind.BirdSmall:   return stage.birdSmallSpeed;
    case EnemyKind.BirdBig:     return stage.birdBigSpeed;
    case EnemyKind.Drone:       return DRONE_SCROLL_SPEED;
    case EnemyKind.Jet:         return JET_SCROLL_SPEED;
    case EnemyKind.Ufo:         return UFO_SCROLL_SPEED;
    case EnemyKind.BannerPlane: return BANNER_PLANE_SCROLL_SPEED;
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

const BANNER_PLANE_MAX_ACTIVE = 2;

function pickEnemyKind(stage: StageParams, score: number, rng: GameState["rng"], bannerPlaneActive: number): EnemyKind | null {
  // Enabled kinds in this stage's mask, weighted by intended frequency.
  // Birds use the per-stage taper (Rare ramps them 1.0 → 0 across the gate range).
  // Drones are intentionally low-weight in Rare so the stage doesn't become a
  // missile gauntlet — once jets are also in the mask (Legendary+) they share
  // the air-vehicle pool so drone density falls further on its own.
  // BannerPlane is hard-capped at BANNER_PLANE_MAX_ACTIVE on screen so the
  // sponsor sign stays a rare sighting rather than a flock.
  const weighted: Array<{ kind: EnemyKind; w: number }> = [];
  const birdW = birdSpawnWeight(stage, score);
  if (stage.enemyMask & ENEMY_BIRD_SMALL) weighted.push({ kind: EnemyKind.BirdSmall, w: birdW });
  if (stage.enemyMask & ENEMY_BIRD_BIG)   weighted.push({ kind: EnemyKind.BirdBig,   w: birdW });
  if (stage.enemyMask & ENEMY_DRONE)        weighted.push({ kind: EnemyKind.Drone,       w: 0.4 });
  if (stage.enemyMask & ENEMY_JET)          weighted.push({ kind: EnemyKind.Jet,         w: 0.7 });
  if (stage.enemyMask & ENEMY_UFO)          weighted.push({ kind: EnemyKind.Ufo,         w: 0.4 });
  if ((stage.enemyMask & ENEMY_BANNER_PLANE) && bannerPlaneActive < BANNER_PLANE_MAX_ACTIVE) {
    weighted.push({ kind: EnemyKind.BannerPlane, w: 0.15 });
  }

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
  let bannerPlaneActive = 0;
  for (const e of state.enemies) if (e.kind === EnemyKind.BannerPlane) bannerPlaneActive++;
  const kind = pickEnemyKind(stage, state.score, state.rng, bannerPlaneActive);
  if (kind === null) return;
  const dims = enemyDims(kind);
  const yMin = ENEMY_SPAWN_Y_MIN + dims.hitboxH / 2;
  const yMax = ENEMY_SPAWN_Y_MAX - dims.hitboxH / 2;
  const y = pickEnemyY(state, stage, kind, yMin, yMax);
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

// Drones (and jets) are tempting blockers — they're slow + missile-firing, so
// when they happen to drift through a pillar's gap as the plane arrives,
// the run is dead-on-arrival. Bias their spawn y into the *solid* half of the
// most-recent pillar so they're never sitting in the gap when the player
// reaches that pillar. Birds and UFO keep the free random spawn.
function pickEnemyY(
  state: GameState,
  stage: StageParams,
  kind: EnemyKind,
  yMin: number,
  yMax: number,
): number {
  const biasable = kind === EnemyKind.Drone || kind === EnemyKind.Jet;
  if (!biasable || !stage.pillarsEnabled || state.pillars.length === 0) {
    return Math.floor(prngRange(state.rng, yMin, yMax));
  }
  const lastPillar = state.pillars[state.pillars.length - 1]!;
  const CLEARANCE = 40; // px above/below the gap to also avoid
  const gapTopAvoid = lastPillar.gapY - PILLAR_GAP / 2 - CLEARANCE;
  const gapBotAvoid = lastPillar.gapY + PILLAR_GAP / 2 + CLEARANCE;

  const upperHi = Math.min(yMax, gapTopAvoid);
  const lowerLo = Math.max(yMin, gapBotAvoid);
  const upperOk = upperHi - yMin > 20;
  const lowerOk = yMax - lowerLo > 20;

  if (upperOk && lowerOk) {
    const above = (prngNextU32(state.rng) & 1) === 0;
    return above
      ? Math.floor(prngRange(state.rng, yMin, upperHi))
      : Math.floor(prngRange(state.rng, lowerLo, yMax));
  }
  if (upperOk) return Math.floor(prngRange(state.rng, yMin, upperHi));
  if (lowerOk) return Math.floor(prngRange(state.rng, lowerLo, yMax));
  // No safe band — fall back to anywhere.
  return Math.floor(prngRange(state.rng, yMin, yMax));
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

  // ---- World scroll speed ----
  const speedMul = computeSpeedMul(input.buttons);
  state.worldSpeedMul = speedMul;
  state.worldDistance += speedMul;

  // ---- Plane vertical steering ----
  let dy = 0;
  if ((input.buttons & BTN_UP) !== 0) dy -= VERT_SPEED;
  if ((input.buttons & BTN_DOWN) !== 0) dy += VERT_SPEED;
  state.plane.vy = dy;
  state.plane.y += dy;

  if (state.plane.y < 0) {
    state.gameOver = true;
    state.gameOverReason = GameOverReason.WorldTop;
    return;
  }
  if (state.plane.y > WORLD_HEIGHT) {
    state.gameOver = true;
    state.gameOverReason = GameOverReason.WorldBottom;
    return;
  }

  const stage = STAGE_TABLE[state.stage]!;

  // ---- Fuel drain (scales with world speed — going fast costs more) ----
  if (stage.fuelEnabled) {
    state.fuel -= stage.fuelDrainPerTick * speedMul;
    if (state.fuel <= 0) {
      state.fuel = 0;
      state.gameOver = true;
      state.gameOverReason = GameOverReason.FuelOut;
      return;
    }
  }

  // ---- Spawn: gated on accumulated world distance, not raw ticks. This is
  // what makes ←/→ throttle scale the actual encounter rate: at 3× speed the
  // world advances 3× per tick, so spawn deadlines arrive 3× more often.
  if (stage.pillarsEnabled && stage.pillarSpawnPeriod > 0) {
    while (state.worldDistance >= state.nextPillarDistance) {
      const gapY = Math.floor(prngRange(state.rng, PILLAR_GAP_MIN_Y, PILLAR_GAP_MAX_Y));
      state.pillars.push({
        id: state.nextPillarId++,
        x: WORLD_WIDTH + PILLAR_WIDTH,
        gapY,
        passed: false,
      });
      state.nextPillarDistance += stage.pillarSpawnPeriod;
    }
  }
  if (stage.enemySpawnPeriod > 0) {
    while (state.worldDistance >= state.nextEnemyDistance) {
      spawnEnemy(state, stage);
      state.nextEnemyDistance += stage.enemySpawnPeriod;
    }
  }
  if (stage.fuelEnabled && stage.fuelSpawnPeriod > 0) {
    while (state.worldDistance >= state.nextFuelDistance) {
      spawnFuelToken(state);
      state.nextFuelDistance += stage.fuelSpawnPeriod;
    }
  }
  maybeFireMissiles(state, stage);

  // ---- Plane multi-rect hitbox ----
  // Three rectangles approximate the plane silhouette: tail fin (back-upper),
  // body + cockpit (centre), and engine pods/landing gear (below). Collision
  // is the OR of any part overlapping an obstacle rect.
  const planeY = state.plane.y;
  function planeHits(aabb: { left: number; right: number; top: number; bottom: number }): boolean {
    for (const r of PLANE_HITBOX_PARTS) {
      const cx = PLANE_X + r.offsetX;
      const cy = planeY + r.offsetY;
      const left = cx - r.w / 2;
      const right = cx + r.w / 2;
      const top = cy - r.h / 2;
      const bottom = cy + r.h / 2;
      if (right > aabb.left && left < aabb.right && bottom > aabb.top && top < aabb.bottom) {
        return true;
      }
    }
    return false;
  }
  // The bounding-AABB is still useful for cheap "is anything possibly near?"
  // short-circuits, but the spawn density is low enough that the per-part
  // loop above is fine to run on every entity.

  // ---- Pillars ----
  const pillarInsetX = (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2;
  for (const p of state.pillars) {
    p.x -= PILLAR_SCROLL_SPEED * speedMul;
    if (!p.passed && p.x + PILLAR_WIDTH < PLANE_X) {
      p.passed = true;
      state.score++;
    }
    const pillarLeft = p.x + pillarInsetX;
    const pillarRight = p.x + PILLAR_WIDTH - pillarInsetX;
    const visGapTop = p.gapY - PILLAR_GAP / 2;
    const visGapBottom = p.gapY + PILLAR_GAP / 2;
    const topPillarH = visGapTop;
    const botPillarH = WORLD_HEIGHT - visGapBottom;
    const topInset = (topPillarH * PILLAR_TOP_GAP_PAD_SRC) / PILLAR_SRC_H;
    const botInset = (botPillarH * PILLAR_BOT_GAP_PAD_SRC) / PILLAR_SRC_H;
    const hitGapTop = visGapTop - topInset;
    const hitGapBottom = visGapBottom + botInset;
    if (
      planeHits({ left: pillarLeft, right: pillarRight, top: 0, bottom: hitGapTop }) ||
      planeHits({ left: pillarLeft, right: pillarRight, top: hitGapBottom, bottom: WORLD_HEIGHT })
    ) {
      state.gameOver = true;
      state.gameOverReason = GameOverReason.Pillar;
      return;
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
    e.x += e.vx * speedMul;

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
    if (planeHits({ left: eLeft, right: eRight, top: eTop, bottom: eBottom })) {
      state.gameOver = true;
      state.gameOverReason = reasonForEnemy(e.kind);
      return;
    }
  }
  state.enemies = state.enemies.filter((e) => e.x + enemyDims(e.kind).hitboxW / 2 > 0);

  // ---- Missiles ----
  for (const m of state.missiles) {
    m.x += m.vx * speedMul;
    const mLeft = m.x - MISSILE_HITBOX_W / 2;
    const mRight = m.x + MISSILE_HITBOX_W / 2;
    const mTop = m.y - MISSILE_HITBOX_H / 2;
    const mBottom = m.y + MISSILE_HITBOX_H / 2;
    if (planeHits({ left: mLeft, right: mRight, top: mTop, bottom: mBottom })) {
      state.gameOver = true;
      state.gameOverReason = GameOverReason.Missile;
      return;
    }
  }
  state.missiles = state.missiles.filter((m) => m.x + MISSILE_HITBOX_W / 2 > 0);

  // ---- Fuel tokens ----
  if (stage.fuelEnabled) {
    for (const t of state.fuelTokens) {
      t.x -= FUEL_TOKEN_SCROLL_SPEED * speedMul;
    }
    state.fuelTokens = state.fuelTokens.filter((t) => {
      if (t.x + FUEL_TOKEN_HITBOX / 2 < 0) return false;
      const tLeft = t.x - FUEL_TOKEN_HITBOX / 2;
      const tRight = t.x + FUEL_TOKEN_HITBOX / 2;
      const tTop = t.y - FUEL_TOKEN_HITBOX / 2;
      const tBottom = t.y + FUEL_TOKEN_HITBOX / 2;
      const collide = planeHits({ left: tLeft, right: tRight, top: tTop, bottom: tBottom });
      if (collide) {
        state.fuel = FUEL_MAX; // top off completely
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
    // Defer the new stage's first spawn by one full period so we don't burst
    // out a backlog (worldDistance may already be far past zero).
    const ns = STAGE_TABLE[nextIdx]!;
    if (ns.pillarsEnabled) state.nextPillarDistance = state.worldDistance + ns.pillarSpawnPeriod;
    if (ns.enemySpawnPeriod > 0) state.nextEnemyDistance = state.worldDistance + ns.enemySpawnPeriod;
    if (ns.fuelEnabled) state.nextFuelDistance = state.worldDistance + ns.fuelSpawnPeriod;
  }
}

export { enemyDims as enemyDimsForKind };
export type { Enemy };
