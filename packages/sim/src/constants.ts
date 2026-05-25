export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const TICK_RATE_HZ = 60;
export const TICK_MS = 1000 / TICK_RATE_HZ;

export const PLANE_X = 320;
export const PLANE_START_Y = WORLD_HEIGHT / 2;
// Displayed at the source PNG's native 256×128. The silhouette inside the
// sprite is measured (via tests/plane_alpha.mjs) at 241×84, with three
// distinct "limbs" — tail fin (back, up), body+cockpit (centre), and the
// engine pods hanging below the wings (mid, down). A single rectangle would
// either over-cover (false positives in the empty rows above/below the body)
// or under-cover (misses the tail fin or pods). Multi-rect hugs the shape.
export const PLANE_DISPLAY_W = 256;
export const PLANE_DISPLAY_H = 128;

export interface HitRect {
  offsetX: number; // centre x offset from PLANE_X
  offsetY: number; // centre y offset from plane.y
  w: number;
  h: number;
}

export const PLANE_HITBOX_PARTS: readonly HitRect[] = [
  { offsetX: -88, offsetY: -34, w: 40,  h: 34 }, // tail fin
  { offsetX:  -4, offsetY:  +2, w: 240, h: 38 }, // body + cockpit
  { offsetX: +34, offsetY: +27, w: 110, h: 14 }, // engine pods / landing gear
];

// Outer AABB of all parts — kept for the debug overlay and for tests that
// only care about a conservative bounding box.
export const PLANE_HITBOX_W = 240;
export const PLANE_HITBOX_H = 102;
export const PLANE_HITBOX_OFFSET_Y = -4;

export const VERT_SPEED = 6;

export const PILLAR_WIDTH = 110;
export const PILLAR_GAP = 220;
// Cloud silhouette is narrower than the 110px sprite. PILLAR_HITBOX_W is sized
// so the wider of the two cloud silhouettes fits with negligible slack; the
// narrower top_pillar leaves ~3 px of harmless slack inside the hitbox.
export const PILLAR_HITBOX_W = 78;
// The two pillar PNGs have transparent padding between the cloud tip and the
// gap-facing edge of the sprite. When the sprite is stretched to its displayed
// height, that padding scales — so the gap-side hitbox inset must be a
// proportion of each pillar's displayed height, not a flat constant.
// Values measured from the actual PNGs via tests/hitbox_check.mjs.
export const PILLAR_SRC_H = 1536;
export const PILLAR_TOP_GAP_PAD_SRC = 90; // top_pillar.png: alpha ends 90 px above sprite bottom
export const PILLAR_BOT_GAP_PAD_SRC = 99; // bottom_pillar.png: alpha starts 99 px below sprite top
export const PILLAR_SCROLL_SPEED = 3.2;
export const PILLAR_SPAWN_PERIOD_TICKS = 110;
export const PILLAR_GAP_MIN_Y = 160;
export const PILLAR_GAP_MAX_Y = WORLD_HEIGHT - 160;

// Birds. Both PNGs are 1536×1024; the bird occupies most of the canvas with a
// fair amount of empty wing-extent. Tuned smaller so the bird-only stages
// don't feel like dodging hawks the size of the plane.
export const BIRD_SMALL_DISPLAY_W = 34;
export const BIRD_SMALL_DISPLAY_H = 24;
export const BIRD_SMALL_HITBOX_W = 22;
export const BIRD_SMALL_HITBOX_H = 14;

export const BIRD_BIG_DISPLAY_W = 40;
export const BIRD_BIG_DISPLAY_H = 28;
export const BIRD_BIG_HITBOX_W = 28;
export const BIRD_BIG_HITBOX_H = 16;

// Banner plane — slow propeller plane towing a sponsor banner. Hitbox covers
// only the plane fuselage; the trailing banner is decorative.
export const BANNER_PLANE_DISPLAY_W = 96;
export const BANNER_PLANE_DISPLAY_H = 96;
export const BANNER_PLANE_HITBOX_W = 64;
export const BANNER_PLANE_HITBOX_H = 36;
export const BANNER_PLANE_SCROLL_SPEED = 2.8;

// Enemies spawn just off-screen right and scroll left toward the plane.
export const ENEMY_SPAWN_X_MARGIN = 80;
// Vertical spawn band — keeps birds from clipping the top/bottom of the world.
export const ENEMY_SPAWN_Y_MIN = 80;
export const ENEMY_SPAWN_Y_MAX = WORLD_HEIGHT - 80;

// Fuel — drives the descent pressure from Stage 2 onward.
export const FUEL_MAX = 100;
export const FUEL_INITIAL = 100;
export const FUEL_PICKUP_AMOUNT = 30;

// Fuel tokens. PNG is 1254×1254 square. Render at 56×56, hit at 44×44.
export const FUEL_TOKEN_DISPLAY = 56;
export const FUEL_TOKEN_HITBOX = 44;
export const FUEL_TOKEN_SCROLL_SPEED = 3.2;

// Drone — slow hover, scrolls left, fires missiles.
export const DRONE_DISPLAY_W = 90;
export const DRONE_DISPLAY_H = 44;
export const DRONE_HITBOX_W = 68;
export const DRONE_HITBOX_H = 26;
export const DRONE_SCROLL_SPEED = 1.8;
export const DRONE_FIRE_PERIOD_TICKS = 210; // one missile every 3.5s (per drone) — was 90

// Jet — fast flyby.
export const JET_DISPLAY_W = 140;
export const JET_DISPLAY_H = 64;
export const JET_HITBOX_W = 108;
export const JET_HITBOX_H = 38;
export const JET_SCROLL_SPEED = 5.6;
export const JET_FIRE_PERIOD_TICKS = 240; // was 120 — jets pass fast, no need to spam

// UFO — zigzag boss. vy oscillates sinusoidally.
export const UFO_DISPLAY_W = 130;
export const UFO_DISPLAY_H = 86;
export const UFO_HITBOX_W = 96;
export const UFO_HITBOX_H = 58;
export const UFO_SCROLL_SPEED = 2.2;
export const UFO_ZIGZAG_AMPLITUDE = 110; // px peak vertical excursion
// Divisible by 4 so the triangle-wave quarter-period (Q = P/4) is an exact
// integer — keeps the motion bit-identical once the sim moves to Q24.8.
export const UFO_ZIGZAG_PERIOD_TICKS = 88;

// Missiles. Source sheet is 591×222 per frame.
export const MISSILE_DISPLAY_W = 58;
export const MISSILE_DISPLAY_H = 22;
export const MISSILE_HITBOX_W = 42;
export const MISSILE_HITBOX_H = 14;
export const MISSILE_SPEED = 7.5; // px/tick — faster than the world to threaten

// Mythical-only: lightning flickers visibility briefly every ~8s.
export const FLICKER_PERIOD_TICKS = 480;
export const FLICKER_DURATION_TICKS = 18;
