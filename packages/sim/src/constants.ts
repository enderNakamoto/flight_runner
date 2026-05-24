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
