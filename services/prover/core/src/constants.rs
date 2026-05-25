//! Sim constants — mirror of `packages/sim/src/constants.ts`.
//!
//! Sizes / coordinates / source-PNG measurements stay as plain integer
//! pixels (just like TS) since they're easier to read that way and the sim
//! wraps them in `fp()` at use sites. Speed constants — anything that lands
//! directly on a Q24.8 position via `+=` — are pre-shifted via `fp::fp()`.

use crate::fp::fp;

// ---- World ---------------------------------------------------------------
pub const WORLD_WIDTH: i32 = 1280;
pub const WORLD_HEIGHT: i32 = 720;
pub const TICK_RATE_HZ: u32 = 60;

// ---- Plane ---------------------------------------------------------------
pub const PLANE_X: i32 = 320;
pub const PLANE_START_Y: i32 = WORLD_HEIGHT / 2;
pub const PLANE_DISPLAY_W: i32 = 256;
pub const PLANE_DISPLAY_H: i32 = 128;

/// One hitbox rectangle of the plane multi-rect silhouette. Centre offsets
/// are relative to `(PLANE_X, plane.y)`; widths/heights are display px.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HitRect {
    pub offset_x: i32,
    pub offset_y: i32,
    pub w: i32,
    pub h: i32,
}

pub const PLANE_HITBOX_PARTS: &[HitRect] = &[
    HitRect { offset_x: -88, offset_y: -34, w: 40,  h: 34 }, // tail fin
    HitRect { offset_x:  -4, offset_y:   2, w: 240, h: 38 }, // body + cockpit
    HitRect { offset_x:  34, offset_y:  27, w: 110, h: 14 }, // engine pods / landing gear
];

pub const PLANE_HITBOX_W: i32 = 240;
pub const PLANE_HITBOX_H: i32 = 102;
pub const PLANE_HITBOX_OFFSET_Y: i32 = -4;

pub const VERT_SPEED: i32 = fp(6.0);  // Q24.8 px / tick

// ---- Pillars -------------------------------------------------------------
pub const PILLAR_WIDTH: i32 = 110;
pub const PILLAR_GAP: i32 = 220;
pub const PILLAR_HITBOX_W: i32 = 78;
pub const PILLAR_SRC_H: i32 = 1536;
pub const PILLAR_TOP_GAP_PAD_SRC: i32 = 90;
pub const PILLAR_BOT_GAP_PAD_SRC: i32 = 99;
pub const PILLAR_SCROLL_SPEED: i32 = fp(3.2);  // Q24.8 (=819, rep. 3.199…)
pub const PILLAR_SPAWN_PERIOD_TICKS: u32 = 110;
pub const PILLAR_GAP_MIN_Y: i32 = 160;
pub const PILLAR_GAP_MAX_Y: i32 = WORLD_HEIGHT - 160;

// ---- Birds ---------------------------------------------------------------
pub const BIRD_SMALL_DISPLAY_W: i32 = 34;
pub const BIRD_SMALL_DISPLAY_H: i32 = 24;
pub const BIRD_SMALL_HITBOX_W: i32 = 22;
pub const BIRD_SMALL_HITBOX_H: i32 = 14;

pub const BIRD_BIG_DISPLAY_W: i32 = 40;
pub const BIRD_BIG_DISPLAY_H: i32 = 28;
pub const BIRD_BIG_HITBOX_W: i32 = 28;
pub const BIRD_BIG_HITBOX_H: i32 = 16;

// ---- Banner plane --------------------------------------------------------
pub const BANNER_PLANE_DISPLAY_W: i32 = 96;
pub const BANNER_PLANE_DISPLAY_H: i32 = 96;
pub const BANNER_PLANE_HITBOX_W: i32 = 64;
pub const BANNER_PLANE_HITBOX_H: i32 = 36;
pub const BANNER_PLANE_SCROLL_SPEED: i32 = fp(2.8);

// ---- Spawn band ----------------------------------------------------------
pub const ENEMY_SPAWN_X_MARGIN: i32 = 80;
pub const ENEMY_SPAWN_Y_MIN: i32 = 80;
pub const ENEMY_SPAWN_Y_MAX: i32 = WORLD_HEIGHT - 80;

// ---- Fuel ----------------------------------------------------------------
pub const FUEL_MAX: i32 = 100;
pub const FUEL_INITIAL: i32 = 100;
pub const FUEL_PICKUP_AMOUNT: i32 = 30;

pub const FUEL_TOKEN_DISPLAY: i32 = 56;
pub const FUEL_TOKEN_HITBOX: i32 = 44;
pub const FUEL_TOKEN_SCROLL_SPEED: i32 = fp(3.2);

// ---- Drone ---------------------------------------------------------------
pub const DRONE_DISPLAY_W: i32 = 90;
pub const DRONE_DISPLAY_H: i32 = 44;
pub const DRONE_HITBOX_W: i32 = 68;
pub const DRONE_HITBOX_H: i32 = 26;
pub const DRONE_SCROLL_SPEED: i32 = fp(1.8);
pub const DRONE_FIRE_PERIOD_TICKS: u32 = 210;

// ---- Jet -----------------------------------------------------------------
pub const JET_DISPLAY_W: i32 = 140;
pub const JET_DISPLAY_H: i32 = 64;
pub const JET_HITBOX_W: i32 = 108;
pub const JET_HITBOX_H: i32 = 38;
pub const JET_SCROLL_SPEED: i32 = fp(5.6);
pub const JET_FIRE_PERIOD_TICKS: u32 = 240;

// ---- UFO -----------------------------------------------------------------
pub const UFO_DISPLAY_W: i32 = 130;
pub const UFO_DISPLAY_H: i32 = 86;
pub const UFO_HITBOX_W: i32 = 96;
pub const UFO_HITBOX_H: i32 = 58;
pub const UFO_SCROLL_SPEED: i32 = fp(2.2);
pub const UFO_ZIGZAG_AMPLITUDE: i32 = 110;
pub const UFO_ZIGZAG_PERIOD_TICKS: u32 = 88;

// ---- Missiles ------------------------------------------------------------
pub const MISSILE_DISPLAY_W: i32 = 58;
pub const MISSILE_DISPLAY_H: i32 = 22;
pub const MISSILE_HITBOX_W: i32 = 42;
pub const MISSILE_HITBOX_H: i32 = 14;
pub const MISSILE_SPEED: i32 = fp(7.5);

// ---- Visibility flicker --------------------------------------------------
pub const FLICKER_PERIOD_TICKS: u32 = 480;
pub const FLICKER_DURATION_TICKS: u32 = 18;

#[cfg(test)]
mod tests {
    use super::*;

    /// Pin the Q24.8 values for every speed constant. Mirrors the same `fp()`
    /// truncation that the TS sim applies — any drift would shift collision
    /// timing in the corpus.
    #[test]
    fn speed_constants_pinned() {
        assert_eq!(VERT_SPEED, 1536);                  // fp(6.0)
        assert_eq!(PILLAR_SCROLL_SPEED, 819);          // fp(3.2)  (rep. 3.199…)
        assert_eq!(FUEL_TOKEN_SCROLL_SPEED, 819);      // fp(3.2)
        assert_eq!(BANNER_PLANE_SCROLL_SPEED, 716);    // fp(2.8)
        assert_eq!(DRONE_SCROLL_SPEED, 460);           // fp(1.8)
        assert_eq!(JET_SCROLL_SPEED, 1433);            // fp(5.6)
        assert_eq!(UFO_SCROLL_SPEED, 563);             // fp(2.2)
        assert_eq!(MISSILE_SPEED, 1920);               // fp(7.5)
    }

    #[test]
    fn plane_hitbox_parts_unchanged() {
        assert_eq!(PLANE_HITBOX_PARTS.len(), 3);
        let tail = PLANE_HITBOX_PARTS[0];
        assert_eq!((tail.offset_x, tail.offset_y, tail.w, tail.h), (-88, -34, 40, 34));
        let body = PLANE_HITBOX_PARTS[1];
        assert_eq!((body.offset_x, body.offset_y, body.w, body.h), (-4, 2, 240, 38));
        let pods = PLANE_HITBOX_PARTS[2];
        assert_eq!((pods.offset_x, pods.offset_y, pods.w, pods.h), (34, 27, 110, 14));
    }

    #[test]
    fn world_dimensions_match_ts() {
        assert_eq!(WORLD_WIDTH, 1280);
        assert_eq!(WORLD_HEIGHT, 720);
        assert_eq!(PLANE_START_Y, 360);
        assert_eq!(PILLAR_GAP_MAX_Y, 560);
        assert_eq!(ENEMY_SPAWN_Y_MAX, 640);
    }
}
