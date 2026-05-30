//! Tick reducer — mirror of `packages/sim/src/step.ts`.
//!
//! Same field order, same math, same prng draws, same module-scope pre-fp'd
//! coordinate constants. Anything `fp`-related in TS lands here as i32
//! arithmetic; anything that went through `prngRange + Math.floor` in TS
//! lands here as `prng_range + .floor() as i32`.

use crate::constants::{
    BANNER_PLANE_DISPLAY_H, BANNER_PLANE_DISPLAY_W, BANNER_PLANE_HITBOX_H, BANNER_PLANE_HITBOX_W,
    BANNER_PLANE_SCROLL_SPEED, BIRD_BIG_DISPLAY_H, BIRD_BIG_DISPLAY_W, BIRD_BIG_HITBOX_H,
    BIRD_BIG_HITBOX_W, BIRD_SMALL_DISPLAY_H, BIRD_SMALL_DISPLAY_W, BIRD_SMALL_HITBOX_H,
    BIRD_SMALL_HITBOX_W, DRONE_DISPLAY_H, DRONE_DISPLAY_W, DRONE_FIRE_PERIOD_TICKS, DRONE_HITBOX_H,
    DRONE_HITBOX_W, DRONE_SCROLL_SPEED, ENEMY_SPAWN_X_MARGIN, ENEMY_SPAWN_Y_MAX, ENEMY_SPAWN_Y_MIN,
    FUEL_MAX, FUEL_TOKEN_HITBOX, FUEL_TOKEN_SCROLL_SPEED, JET_DISPLAY_H, JET_DISPLAY_W,
    JET_FIRE_PERIOD_TICKS, JET_HITBOX_H, JET_HITBOX_W, JET_SCROLL_SPEED, MISSILE_DISPLAY_W,
    MISSILE_HITBOX_H, MISSILE_HITBOX_W, MISSILE_SPEED, PILLAR_BOT_GAP_PAD_SRC, PILLAR_GAP,
    PILLAR_GAP_MAX_Y, PILLAR_GAP_MIN_Y, PILLAR_HITBOX_W, PILLAR_SCROLL_SPEED, PILLAR_SRC_H,
    PILLAR_TOP_GAP_PAD_SRC, PILLAR_WIDTH, PLANE_HITBOX_PARTS, PLANE_X, UFO_DISPLAY_H, UFO_DISPLAY_W,
    UFO_HITBOX_H, UFO_HITBOX_W, UFO_SCROLL_SPEED, UFO_ZIGZAG_AMPLITUDE, UFO_ZIGZAG_PERIOD_TICKS,
    VERT_SPEED, WORLD_HEIGHT, WORLD_WIDTH,
};
use crate::fp::{fp, fp_floor, fp_mul};
use crate::prng::{prng_next_u32, prng_range, PrngState};
use crate::stages::{
    StageParams, ENEMY_BANNER_PLANE, ENEMY_BIRD_BIG, ENEMY_BIRD_SMALL, ENEMY_DRONE, ENEMY_JET,
    ENEMY_UFO, MISSILE_COMMON, MISSILE_RARE, MISSILE_UNCOMMON, STAGE_TABLE,
};
use crate::types::{
    Enemy, EnemyKind, FuelToken, GameOverReason, GameState, Missile, MissileTier, Pillar,
    PlayerInput, BTN_DOWN, BTN_LEFT, BTN_RIGHT, BTN_UP, SCORE_CAP,
};

// ---- Pre-fp'd coordinate constants ----
// Computed once at compile time (fp() is a const fn) so each frame is pure
// add/compare. Mirrors the same `_FP` set in packages/sim/src/step.ts.
const PLANE_X_FP: i32 = fp(PLANE_X as f64);
const WORLD_HEIGHT_FP: i32 = fp(WORLD_HEIGHT as f64);
const PILLAR_WIDTH_FP: i32 = fp(PILLAR_WIDTH as f64);
const PILLAR_GAP_HALF_FP: i32 = fp(PILLAR_GAP as f64) >> 1;
const PILLAR_INSET_X_FP: i32 = fp(((PILLAR_WIDTH - PILLAR_HITBOX_W) as f64) / 2.0);
const ENEMY_SPAWN_X_FP: i32 = fp((WORLD_WIDTH + ENEMY_SPAWN_X_MARGIN) as f64);
const PILLAR_SPAWN_X_FP: i32 = fp((WORLD_WIDTH + PILLAR_WIDTH) as f64);
const MISSILE_HALF_W_FP: i32 = fp(MISSILE_DISPLAY_W as f64) >> 1;
const MISSILE_HITBOX_HALF_W_FP: i32 = fp(MISSILE_HITBOX_W as f64) >> 1;
const MISSILE_HITBOX_HALF_H_FP: i32 = fp(MISSILE_HITBOX_H as f64) >> 1;
const FUEL_TOKEN_HALF_FP: i32 = fp(FUEL_TOKEN_HITBOX as f64) >> 1;

// ---- World-speed multipliers in Q24.8 ----
// Default (no throttle held) was 1.0; bumped to 1.5 so the baseline
// feels closer to the 3× right-throttle without changing the throttle
// ceiling. Must stay in sync with packages/sim/src/step.ts.
const SPEED_SLOW: i32 = fp(0.5);
const SPEED_NORMAL: i32 = fp(1.5);
const SPEED_FAST: i32 = fp(3.0);

const BANNER_PLANE_MAX_ACTIVE: usize = 2;

fn reason_for_enemy(kind: EnemyKind) -> GameOverReason {
    match kind {
        EnemyKind::BirdSmall | EnemyKind::BirdBig => GameOverReason::Bird,
        EnemyKind::Drone => GameOverReason::Drone,
        EnemyKind::Jet => GameOverReason::Jet,
        EnemyKind::Ufo => GameOverReason::Ufo,
        EnemyKind::BannerPlane => GameOverReason::BannerPlane,
    }
}

fn compute_speed_mul(buttons: u8) -> i32 {
    let left = (buttons & BTN_LEFT) != 0;
    let right = (buttons & BTN_RIGHT) != 0;
    if left && !right {
        SPEED_SLOW
    } else if right && !left {
        SPEED_FAST
    } else {
        SPEED_NORMAL
    }
}

#[derive(Clone, Copy)]
pub struct EntityDims {
    pub hitbox_w: i32,
    pub hitbox_h: i32,
    pub display_w: i32,
    pub display_h: i32,
}

pub fn enemy_dims(kind: EnemyKind) -> EntityDims {
    match kind {
        EnemyKind::BirdSmall => EntityDims {
            hitbox_w: BIRD_SMALL_HITBOX_W, hitbox_h: BIRD_SMALL_HITBOX_H,
            display_w: BIRD_SMALL_DISPLAY_W, display_h: BIRD_SMALL_DISPLAY_H,
        },
        EnemyKind::BirdBig => EntityDims {
            hitbox_w: BIRD_BIG_HITBOX_W, hitbox_h: BIRD_BIG_HITBOX_H,
            display_w: BIRD_BIG_DISPLAY_W, display_h: BIRD_BIG_DISPLAY_H,
        },
        EnemyKind::Drone => EntityDims {
            hitbox_w: DRONE_HITBOX_W, hitbox_h: DRONE_HITBOX_H,
            display_w: DRONE_DISPLAY_W, display_h: DRONE_DISPLAY_H,
        },
        EnemyKind::Jet => EntityDims {
            hitbox_w: JET_HITBOX_W, hitbox_h: JET_HITBOX_H,
            display_w: JET_DISPLAY_W, display_h: JET_DISPLAY_H,
        },
        EnemyKind::Ufo => EntityDims {
            hitbox_w: UFO_HITBOX_W, hitbox_h: UFO_HITBOX_H,
            display_w: UFO_DISPLAY_W, display_h: UFO_DISPLAY_H,
        },
        EnemyKind::BannerPlane => EntityDims {
            hitbox_w: BANNER_PLANE_HITBOX_W, hitbox_h: BANNER_PLANE_HITBOX_H,
            display_w: BANNER_PLANE_DISPLAY_W, display_h: BANNER_PLANE_DISPLAY_H,
        },
    }
}

fn enemy_base_speed(stage: &StageParams, kind: EnemyKind) -> i32 {
    match kind {
        EnemyKind::BirdSmall => stage.bird_small_speed,
        EnemyKind::BirdBig => stage.bird_big_speed,
        EnemyKind::Drone => DRONE_SCROLL_SPEED,
        EnemyKind::Jet => JET_SCROLL_SPEED,
        EnemyKind::Ufo => UFO_SCROLL_SPEED,
        EnemyKind::BannerPlane => BANNER_PLANE_SCROLL_SPEED,
    }
}

fn fire_cadence_for_kind(kind: EnemyKind) -> u32 {
    if matches!(kind, EnemyKind::Jet) { JET_FIRE_PERIOD_TICKS } else { DRONE_FIRE_PERIOD_TICKS }
}

/// Linear ramp: full weight at startScore, zero at endScore. Mirrors TS.
fn bird_spawn_weight(stage: &StageParams, score: u32) -> f64 {
    match stage.bird_taper {
        None => {
            if (stage.enemy_mask & (ENEMY_BIRD_SMALL | ENEMY_BIRD_BIG)) != 0 { 1.0 } else { 0.0 }
        }
        Some(taper) => {
            if score <= taper.start_score { 1.0 }
            else if score >= taper.end_score { 0.0 }
            else {
                (taper.end_score - score) as f64 / (taper.end_score - taper.start_score) as f64
            }
        }
    }
}

fn pick_enemy_kind(
    stage: &StageParams,
    score: u32,
    rng: &mut PrngState,
    banner_plane_active: usize,
) -> Option<EnemyKind> {
    let mut weighted: Vec<(EnemyKind, f64)> = Vec::with_capacity(6);
    let bird_w = bird_spawn_weight(stage, score);
    if stage.enemy_mask & ENEMY_BIRD_SMALL != 0 { weighted.push((EnemyKind::BirdSmall, bird_w)); }
    if stage.enemy_mask & ENEMY_BIRD_BIG != 0   { weighted.push((EnemyKind::BirdBig,   bird_w)); }
    if stage.enemy_mask & ENEMY_DRONE != 0      { weighted.push((EnemyKind::Drone,     0.4)); }
    if stage.enemy_mask & ENEMY_JET != 0        { weighted.push((EnemyKind::Jet,       0.7)); }
    if stage.enemy_mask & ENEMY_UFO != 0        { weighted.push((EnemyKind::Ufo,       0.4)); }
    if (stage.enemy_mask & ENEMY_BANNER_PLANE) != 0 && banner_plane_active < BANNER_PLANE_MAX_ACTIVE {
        weighted.push((EnemyKind::BannerPlane, 0.15));
    }
    let total: f64 = weighted.iter().map(|(_, w)| *w).sum();
    if total <= 0.0 {
        return None;
    }
    // Same f64 formula as TS: (u32 / 2^32) * total.
    let r = (prng_next_u32(rng) as f64 / 4_294_967_296.0_f64) * total;
    let mut acc = 0.0;
    for (kind, w) in &weighted {
        acc += *w;
        if r < acc {
            return Some(*kind);
        }
    }
    Some(weighted.last().expect("weighted is non-empty since total > 0").0)
}

fn roll_missile_frame(tier_mask: u32, rng: &mut PrngState) -> Option<(MissileTier, u8)> {
    let mut tiers: Vec<MissileTier> = Vec::with_capacity(3);
    if tier_mask & MISSILE_COMMON != 0   { tiers.push(MissileTier::Common); }
    if tier_mask & MISSILE_UNCOMMON != 0 { tiers.push(MissileTier::Uncommon); }
    if tier_mask & MISSILE_RARE != 0     { tiers.push(MissileTier::Rare); }
    if tiers.is_empty() {
        return None;
    }
    let tier = tiers[(prng_next_u32(rng) as usize) % tiers.len()];
    let frame: u8 = match tier {
        MissileTier::Common   =>  (prng_next_u32(rng) % 6) as u8,
        MissileTier::Uncommon =>  6 + (prng_next_u32(rng) % 3) as u8,
        MissileTier::Rare     =>  9 + (prng_next_u32(rng) % 3) as u8,
    };
    Some((tier, frame))
}

/// Mirrors TS pickEnemyY. Returns an integer-pixel y; caller wraps in fp() at
/// storage. yMin/yMax come in already adjusted for the entity's hitbox so the
/// spawn band is hitbox-centre-safe.
/// Takes pillars + rng separately (not `&mut GameState`) so the call site can
/// split a disjoint borrow against `state.rng`.
fn pick_enemy_y(
    pillars: &[Pillar],
    stage: &StageParams,
    kind: EnemyKind,
    y_min: i32,
    y_max: i32,
    rng: &mut PrngState,
) -> i32 {
    let biasable = matches!(kind, EnemyKind::Drone | EnemyKind::Jet);
    if !biasable || !stage.pillars_enabled || pillars.is_empty() {
        return prng_range(rng, y_min as f64, y_max as f64).floor() as i32;
    }
    let last_pillar = pillars.last().expect("pillars non-empty checked above");
    const CLEARANCE: i32 = 40;
    let last_gap_y = fp_floor(last_pillar.gap_y);
    let gap_top_avoid = last_gap_y - PILLAR_GAP / 2 - CLEARANCE;
    let gap_bot_avoid = last_gap_y + PILLAR_GAP / 2 + CLEARANCE;

    let upper_hi = y_max.min(gap_top_avoid);
    let lower_lo = y_min.max(gap_bot_avoid);
    let upper_ok = upper_hi - y_min > 20;
    let lower_ok = y_max - lower_lo > 20;

    if upper_ok && lower_ok {
        let above = (prng_next_u32(rng) & 1) == 0;
        if above {
            prng_range(rng, y_min as f64, upper_hi as f64).floor() as i32
        } else {
            prng_range(rng, lower_lo as f64, y_max as f64).floor() as i32
        }
    } else if upper_ok {
        prng_range(rng, y_min as f64, upper_hi as f64).floor() as i32
    } else if lower_ok {
        prng_range(rng, lower_lo as f64, y_max as f64).floor() as i32
    } else {
        prng_range(rng, y_min as f64, y_max as f64).floor() as i32
    }
}

fn spawn_enemy(state: &mut GameState, stage: &StageParams) {
    let banner_plane_active = state.enemies.iter().filter(|e| e.kind == EnemyKind::BannerPlane).count();
    let kind = match pick_enemy_kind(stage, state.score, &mut state.rng, banner_plane_active) {
        Some(k) => k,
        None => return,
    };
    let dims = enemy_dims(kind);
    let y_min = ENEMY_SPAWN_Y_MIN + dims.hitbox_h / 2;
    let y_max = ENEMY_SPAWN_Y_MAX - dims.hitbox_h / 2;
    let y = pick_enemy_y(&state.pillars, stage, kind, y_min, y_max, &mut state.rng);
    let speed = enemy_base_speed(stage, kind);
    let cadence = fire_cadence_for_kind(kind) as f64;
    let fire_delay = prng_range(&mut state.rng, cadence / 2.0, cadence * 1.5).floor() as u32;
    let id = state.next_enemy_id;
    state.next_enemy_id += 1;
    state.enemies.push(Enemy {
        id,
        kind,
        x: ENEMY_SPAWN_X_FP,
        y: fp(y as f64),
        vx: -speed,
        spawn_tick: state.tick,
        spawn_y: fp(y as f64),
        next_fire_tick: state.tick + fire_delay,
        passed: false,
    });
}

fn spawn_fuel_token(state: &mut GameState) {
    let y = prng_range(
        &mut state.rng,
        (ENEMY_SPAWN_Y_MIN + 30) as f64,
        (ENEMY_SPAWN_Y_MAX - 30) as f64,
    ).floor() as i32;
    let id = state.next_fuel_token_id;
    state.next_fuel_token_id += 1;
    state.fuel_tokens.push(FuelToken {
        id,
        x: ENEMY_SPAWN_X_FP,
        y: fp(y as f64),
    });
}

fn maybe_fire_missiles(state: &mut GameState, stage: &StageParams) {
    if stage.missile_tier_mask == 0 || stage.missile_max_in_flight == 0 {
        return;
    }
    if state.missiles.len() as u32 >= stage.missile_max_in_flight {
        return;
    }
    // Walk enemies in order, fire one missile per eligible drone/jet that's
    // hit its cadence and still ahead of the plane.
    for i in 0..state.enemies.len() {
        let (kind, ex, e_next_fire) = {
            let e = &state.enemies[i];
            (e.kind, e.x, e.next_fire_tick)
        };
        if !matches!(kind, EnemyKind::Drone | EnemyKind::Jet) { continue; }
        if ex <= PLANE_X_FP { continue; }
        if state.tick < e_next_fire { continue; }
        if state.missiles.len() as u32 >= stage.missile_max_in_flight { break; }

        let choice = match roll_missile_frame(stage.missile_tier_mask, &mut state.rng) {
            Some(c) => c,
            None => continue,
        };
        let (e_y, e_x) = {
            let e = &state.enemies[i];
            (e.y, e.x)
        };
        let id = state.next_missile_id;
        state.next_missile_id += 1;
        state.missiles.push(Missile {
            id,
            tier: choice.0,
            frame: choice.1,
            x: e_x - MISSILE_HALF_W_FP,
            y: e_y,
            vx: -MISSILE_SPEED,
        });
        // Reset the firing enemy's cadence.
        let cadence = fire_cadence_for_kind(kind);
        state.enemies[i].next_fire_tick = state.tick + cadence;
    }
}

#[derive(Clone, Copy)]
struct AABB {
    left: i32,
    right: i32,
    top: i32,
    bottom: i32,
}

fn plane_hits(parts: &[AABB], aabb: AABB) -> bool {
    for p in parts {
        if p.right > aabb.left && p.left < aabb.right && p.bottom > aabb.top && p.top < aabb.bottom {
            return true;
        }
    }
    false
}

/// Main reducer. Mirror of TS `stepMut`.
pub fn step_mut(state: &mut GameState, input: PlayerInput) {
    if state.game_over {
        return;
    }
    state.tick += 1;
    state.stage_just_changed = false;

    // ---- World scroll speed ----
    let speed_mul = compute_speed_mul(input.buttons);
    state.world_speed_mul = speed_mul;
    state.world_distance += speed_mul;

    // ---- Plane vertical steering ----
    let mut dy: i32 = 0;
    if input.buttons & BTN_UP != 0 { dy -= VERT_SPEED; }
    if input.buttons & BTN_DOWN != 0 { dy += VERT_SPEED; }
    state.plane.vy = dy;
    state.plane.y += dy;

    if state.plane.y < 0 {
        state.game_over = true;
        state.game_over_reason = GameOverReason::WorldTop;
        return;
    }
    if state.plane.y > WORLD_HEIGHT_FP {
        state.game_over = true;
        state.game_over_reason = GameOverReason::WorldBottom;
        return;
    }

    let stage_idx = state.stage as usize;
    let stage = &STAGE_TABLE[stage_idx];

    // ---- Fuel drain ----
    if stage.fuel_enabled {
        state.fuel -= fp_mul(stage.fuel_drain_per_tick, speed_mul);
        if state.fuel <= 0 {
            state.fuel = 0;
            state.game_over = true;
            state.game_over_reason = GameOverReason::FuelOut;
            return;
        }
    }

    // ---- Spawn ----
    if stage.pillars_enabled && stage.pillar_spawn_period > 0 {
        while state.world_distance >= state.next_pillar_distance {
            let gap_y = prng_range(
                &mut state.rng,
                PILLAR_GAP_MIN_Y as f64,
                PILLAR_GAP_MAX_Y as f64,
            ).floor() as i32;
            let id = state.next_pillar_id;
            state.next_pillar_id += 1;
            state.pillars.push(Pillar {
                id,
                x: PILLAR_SPAWN_X_FP,
                gap_y: fp(gap_y as f64),
                passed: false,
            });
            state.next_pillar_distance += stage.pillar_spawn_period;
        }
    }
    if stage.enemy_spawn_period > 0 {
        while state.world_distance >= state.next_enemy_distance {
            spawn_enemy(state, stage);
            state.next_enemy_distance += stage.enemy_spawn_period;
        }
    }
    if stage.fuel_enabled && stage.fuel_spawn_period > 0 {
        while state.world_distance >= state.next_fuel_distance {
            spawn_fuel_token(state);
            state.next_fuel_distance += stage.fuel_spawn_period;
        }
    }
    maybe_fire_missiles(state, stage);

    // ---- Plane hitbox parts (precomputed once per frame) ----
    let plane_y = state.plane.y;
    let mut plane_rects: [AABB; 3] = [AABB { left: 0, right: 0, top: 0, bottom: 0 }; 3];
    for (i, r) in PLANE_HITBOX_PARTS.iter().enumerate() {
        let cx = PLANE_X_FP + fp(r.offset_x as f64);
        let cy = plane_y + fp(r.offset_y as f64);
        let hw = fp(r.w as f64) >> 1;
        let hh = fp(r.h as f64) >> 1;
        plane_rects[i] = AABB { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
    }

    // ---- Pillars ----
    let mut pillar_collision = false;
    for p in state.pillars.iter_mut() {
        p.x -= fp_mul(PILLAR_SCROLL_SPEED, speed_mul);
        if !p.passed && p.x + PILLAR_WIDTH_FP < PLANE_X_FP {
            p.passed = true;
            state.score += 1;
        }
        let pillar_left = p.x + PILLAR_INSET_X_FP;
        let pillar_right = p.x + PILLAR_WIDTH_FP - PILLAR_INSET_X_FP;
        let vis_gap_top = p.gap_y - PILLAR_GAP_HALF_FP;
        let vis_gap_bottom = p.gap_y + PILLAR_GAP_HALF_FP;
        let top_pillar_h = vis_gap_top;
        let bot_pillar_h = WORLD_HEIGHT_FP - vis_gap_bottom;
        let top_inset = (top_pillar_h as i64 * PILLAR_TOP_GAP_PAD_SRC as i64 / PILLAR_SRC_H as i64) as i32;
        let bot_inset = (bot_pillar_h as i64 * PILLAR_BOT_GAP_PAD_SRC as i64 / PILLAR_SRC_H as i64) as i32;
        let hit_gap_top = vis_gap_top - top_inset;
        let hit_gap_bottom = vis_gap_bottom + bot_inset;
        if plane_hits(&plane_rects, AABB { left: pillar_left, right: pillar_right, top: 0, bottom: hit_gap_top })
            || plane_hits(&plane_rects, AABB { left: pillar_left, right: pillar_right, top: hit_gap_bottom, bottom: WORLD_HEIGHT_FP })
        {
            pillar_collision = true;
            break;
        }
    }
    if pillar_collision {
        state.game_over = true;
        state.game_over_reason = GameOverReason::Pillar;
        return;
    }
    if let Some(first) = state.pillars.first() {
        if first.x + PILLAR_WIDTH_FP < 0 {
            state.pillars.remove(0);
        }
    }

    // ---- Enemies ----
    let mut enemy_collision: Option<EnemyKind> = None;
    let tick_now = state.tick;
    for e in state.enemies.iter_mut() {
        if matches!(e.kind, EnemyKind::Ufo) {
            // Triangle-wave zigzag in Q24.8.
            let p_ticks = UFO_ZIGZAG_PERIOD_TICKS as i64;
            let q = (p_ticks >> 2) as i64;
            let a_fp = fp(UFO_ZIGZAG_AMPLITUDE as f64) as i64;
            let t = ((tick_now as i64 - e.spawn_tick as i64).rem_euclid(p_ticks)) as i64;
            let offset = if t < q {
                ((t * a_fp) / q) as i32
            } else if t < 2 * q {
                (((2 * q - t) * a_fp) / q) as i32
            } else if t < 3 * q {
                -(((t - 2 * q) * a_fp) / q) as i32
            } else {
                -(((p_ticks - t) * a_fp) / q) as i32
            };
            e.y = e.spawn_y + offset;
        }
        e.x += fp_mul(e.vx, speed_mul);

        let dims = enemy_dims(e.kind);
        let e_half_w = fp(dims.hitbox_w as f64) >> 1;
        let e_half_h = fp(dims.hitbox_h as f64) >> 1;
        if !e.passed && e.x + e_half_w < PLANE_X_FP {
            e.passed = true;
            state.score += if matches!(e.kind, EnemyKind::Ufo) { 5 } else { 1 };
        }
        if plane_hits(&plane_rects, AABB {
            left: e.x - e_half_w, right: e.x + e_half_w,
            top: e.y - e_half_h, bottom: e.y + e_half_h,
        }) {
            enemy_collision = Some(e.kind);
            break;
        }
    }
    if let Some(kind) = enemy_collision {
        state.game_over = true;
        state.game_over_reason = reason_for_enemy(kind);
        return;
    }
    state.enemies.retain(|e| {
        let half_w = fp(enemy_dims(e.kind).hitbox_w as f64) >> 1;
        e.x + half_w > 0
    });

    // ---- Missiles ----
    let mut missile_collision = false;
    for m in state.missiles.iter_mut() {
        m.x += fp_mul(m.vx, speed_mul);
        if plane_hits(&plane_rects, AABB {
            left: m.x - MISSILE_HITBOX_HALF_W_FP, right: m.x + MISSILE_HITBOX_HALF_W_FP,
            top: m.y - MISSILE_HITBOX_HALF_H_FP, bottom: m.y + MISSILE_HITBOX_HALF_H_FP,
        }) {
            missile_collision = true;
            break;
        }
    }
    if missile_collision {
        state.game_over = true;
        state.game_over_reason = GameOverReason::Missile;
        return;
    }
    state.missiles.retain(|m| m.x + MISSILE_HITBOX_HALF_W_FP > 0);

    // ---- Fuel tokens ----
    if stage.fuel_enabled {
        for t in state.fuel_tokens.iter_mut() {
            t.x -= fp_mul(FUEL_TOKEN_SCROLL_SPEED, speed_mul);
        }
        // Cull off-screen + handle pickup collision.
        let mut i = 0;
        while i < state.fuel_tokens.len() {
            let t = &state.fuel_tokens[i];
            if t.x + FUEL_TOKEN_HALF_FP < 0 {
                state.fuel_tokens.remove(i);
                continue;
            }
            let aabb = AABB {
                left: t.x - FUEL_TOKEN_HALF_FP, right: t.x + FUEL_TOKEN_HALF_FP,
                top: t.y - FUEL_TOKEN_HALF_FP, bottom: t.y + FUEL_TOKEN_HALF_FP,
            };
            if plane_hits(&plane_rects, aabb) {
                state.fuel = fp(FUEL_MAX as f64);
                state.score += 1;
                state.fuel_tokens.remove(i);
                continue;
            }
            i += 1;
        }
    } else if !state.fuel_tokens.is_empty() {
        state.fuel_tokens.clear();
    }

    // ---- Stage advancement ----
    let next_idx = stage_idx + 1;
    if next_idx < STAGE_TABLE.len() && state.score >= STAGE_TABLE[next_idx].score_gate {
        state.stage = next_idx as u8;
        state.stage_just_changed = true;
        let ns = &STAGE_TABLE[next_idx];
        if ns.pillars_enabled {
            state.next_pillar_distance = state.world_distance + ns.pillar_spawn_period;
        }
        if ns.enemy_spawn_period > 0 {
            state.next_enemy_distance = state.world_distance + ns.enemy_spawn_period;
        }
        if ns.fuel_enabled {
            state.next_fuel_distance = state.world_distance + ns.fuel_spawn_period;
        }
    }

    // ---- Score cap ----
    // Reaching SCORE_CAP ends the run as a "win" — the player landed in
    // DXB. Capped so the HUD reads exactly the ceiling rather than the
    // over-the-line tick. Runs that already ended for another reason this
    // tick keep their original game-over reason.
    if !state.game_over && state.score >= SCORE_CAP {
        state.score = SCORE_CAP;
        state.game_over = true;
        state.game_over_reason = GameOverReason::ReachedDXB;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serialize::serialize_state;
    use crate::stages::Stage;
    use crate::state::create_initial_state;

    fn drive(seed: i32, stage: Stage, ticks: u32, btn: u8) -> String {
        let mut s = create_initial_state(seed, stage);
        for _ in 0..ticks {
            step_mut(&mut s, PlayerInput { buttons: btn });
        }
        serialize_state(&s).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// The real cross-language check: drive both sims through the same input
    /// for N ticks and compare the resulting serialized bytes. The reference
    /// hex strings were captured by running the TS sim through the same
    /// scenario. Mismatch here means step.rs diverged from step.ts somewhere.
    /// Strings re-captured when SPEED_NORMAL was bumped fp(1.0) → fp(1.5).
    #[test]
    fn ts_parity_zero_input_10_ticks() {
        assert_eq!(
            drive(0x12345678, Stage::Common, 10, 0),
            "0a000000000000000000000000640000000f00000000000000b40000000000000068010000000000c4f42048010000000200000001000000010000000000000001000000010000000000000001000000a50000000e1a05000084000067fcffff008400000000000000000000",
        );
    }

    #[test]
    fn ts_parity_zero_input_50_ticks() {
        assert_eq!(
            drive(0x12345678, Stage::Common, 50, 0),
            "32000000000000000000000000640000004b00000000000000b40000000000000068010000000000c4f42048010000000200000001000000010000000000000001000000010000000000000001000000a5000000464204000084000067fcffff008400000000000000000000",
        );
    }

    #[test]
    fn ts_parity_zero_input_100_ticks_coffee() {
        assert_eq!(
            drive(0x00C0FFEE, Stage::Common, 100, 0),
            "64000000000000000000000000640000009600000000000000b400000000000000680100000000000e9da889010000000200000001000000010000000000000001000000010000000500000001000000da00000078ac03000053010034fdffff005301000000000000000000",
        );
    }

    #[test]
    fn ts_parity_right_throttle_30_ticks() {
        // BTN_RIGHT (8) held → 3× speedMul. Different spawn cadence, different
        // worldDistance accumulation, exercises a divergent path.
        assert_eq!(
            drive(0xCAFEBABE_u32 as i32, Stage::Common, 30, 8),
            "1e000000000000000000000000640000005a00000000000000b40000000000000068010000000000fae73df201000000020000000100000001000000000000000100000001000000000000000100000030010000360c040000b4010067fcffff00b401000000000000000000",
        );
    }

    #[test]
    fn ts_parity_real_corpus_seed_50_ticks() {
        // Corpus seed t2127_s42 with zero input — the same first 50 prng
        // draws used by the TS replay must produce identical state here.
        assert_eq!(
            drive(0x5e570e03, Stage::Common, 50, 0),
            "32000000000000000000000000640000004b00000000000000b400000000000000680100000000005c944db5010000000200000001000000010000000000000001000000010000000000000001000000fe000000464204000037020067fcffff003702000000000000000000",
        );
    }

    #[test]
    fn empty_step_advances_tick() {
        let mut s = create_initial_state(0x12345678, Stage::Common);
        step_mut(&mut s, PlayerInput { buttons: 0 });
        assert_eq!(s.tick, 1);
        assert!(!s.game_over);
    }

    #[test]
    fn step_after_game_over_is_noop() {
        let mut s = create_initial_state(1, Stage::Common);
        s.game_over = true;
        let snapshot = s.clone();
        step_mut(&mut s, PlayerInput { buttons: 0 });
        assert_eq!(s, snapshot);
    }

    /// Plane held UP for long enough must trigger WorldTop.
    #[test]
    fn world_top_kills() {
        let mut s = create_initial_state(1, Stage::Common);
        // VERT_SPEED is fp(6) = 1536 per tick. plane.y starts at fp(360) = 92160.
        // 92160 / 1536 = 60 ticks to reach 0.
        for _ in 0..62 {
            step_mut(&mut s, PlayerInput { buttons: BTN_UP });
            if s.game_over { break; }
        }
        assert!(s.game_over);
        assert_eq!(s.game_over_reason, GameOverReason::WorldTop);
    }

    /// Plane held DOWN must trigger WorldBottom.
    #[test]
    fn world_bottom_kills() {
        let mut s = create_initial_state(1, Stage::Common);
        for _ in 0..62 {
            step_mut(&mut s, PlayerInput { buttons: BTN_DOWN });
            if s.game_over { break; }
        }
        assert!(s.game_over);
        assert_eq!(s.game_over_reason, GameOverReason::WorldBottom);
    }

    #[test]
    fn world_distance_accumulates_speed_mul() {
        let mut s = create_initial_state(1, Stage::Common);
        // 1× speed for 5 ticks
        for _ in 0..5 {
            step_mut(&mut s, PlayerInput { buttons: 0 });
        }
        assert_eq!(s.world_distance, 5 * SPEED_NORMAL); // 5 × fp(1.5) = 5×384 = 1920
    }
}
