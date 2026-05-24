export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const TICK_RATE_HZ = 60;
export const TICK_MS = 1000 / TICK_RATE_HZ;

export const PLANE_X = 320;
export const PLANE_START_Y = WORLD_HEIGHT / 2;
// Displayed at 96x48. Hitbox ~12% inset so visible-edge contact reliably collides
// while corner-pixel overlaps stay forgiving.
export const PLANE_HITBOX_W = 84;
export const PLANE_HITBOX_H = 40;

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

// Birds. Both PNGs are 1536x1024; the bird occupies most of the canvas but
// with a fair bit of empty wing-extent. Displayed sizes + hitboxes chosen by
// eyeballing the sprite and leaving forgiving slack on each side. Adaptive
// per-cloud pixel-fit (like the pillars) can come later when we wire enemy
// sprite alpha bboxes.
export const BIRD_SMALL_DISPLAY_W = 80;
export const BIRD_SMALL_DISPLAY_H = 56;
export const BIRD_SMALL_HITBOX_W = 56;
export const BIRD_SMALL_HITBOX_H = 32;

export const BIRD_BIG_DISPLAY_W = 110;
export const BIRD_BIG_DISPLAY_H = 76;
export const BIRD_BIG_HITBOX_W = 80;
export const BIRD_BIG_HITBOX_H = 46;

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
export const DRONE_DISPLAY_W = 120;
export const DRONE_DISPLAY_H = 60;
export const DRONE_HITBOX_W = 92;
export const DRONE_HITBOX_H = 36;
export const DRONE_SCROLL_SPEED = 1.8;
export const DRONE_FIRE_PERIOD_TICKS = 90; // one missile every 1.5s (per drone)

// Jet — fast flyby.
export const JET_DISPLAY_W = 140;
export const JET_DISPLAY_H = 64;
export const JET_HITBOX_W = 108;
export const JET_HITBOX_H = 38;
export const JET_SCROLL_SPEED = 5.6;
export const JET_FIRE_PERIOD_TICKS = 120;

// UFO — zigzag boss. vy oscillates sinusoidally.
export const UFO_DISPLAY_W = 130;
export const UFO_DISPLAY_H = 86;
export const UFO_HITBOX_W = 96;
export const UFO_HITBOX_H = 58;
export const UFO_SCROLL_SPEED = 2.2;
export const UFO_ZIGZAG_AMPLITUDE = 110; // px peak vertical excursion
export const UFO_ZIGZAG_PERIOD_TICKS = 90;

// Missiles. Source sheet is 591×222 per frame; render at 80×30, hit at 60×20.
export const MISSILE_DISPLAY_W = 80;
export const MISSILE_DISPLAY_H = 30;
export const MISSILE_HITBOX_W = 60;
export const MISSILE_HITBOX_H = 20;
export const MISSILE_SPEED = 7.5; // px/tick — faster than the world to threaten

// Mythical-only: lightning flickers visibility briefly every ~8s.
export const FLICKER_PERIOD_TICKS = 480;
export const FLICKER_DURATION_TICKS = 18;
