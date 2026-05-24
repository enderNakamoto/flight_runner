// Stage → background texture. Backgrounds are grouped by "mood" — Common picks
// between two day-clear variants, Legendary picks among three night-calm
// variants, the rest are 1:1.
//
// The pick is deterministic from the seed so a recorded run replays the same
// visual on every machine. The sim never reads this; it's render-layer only.

import { Stage } from "@flight/sim";

const VARIANTS_BY_STAGE: Record<Stage, readonly string[]> = {
  [Stage.Common]:    ["bg_blue_sky", "bg_blue_sky_mountain"],
  [Stage.Uncommon]:  ["bg_sunset"],
  [Stage.Rare]:      ["bg_dusk"],
  [Stage.Legendary]: ["bg_night_clear", "bg_night_cloudy", "bg_night_cloudy_moon"],
  [Stage.Mythical]:  ["bg_night_stormy"],
};

export function backgroundFor(stage: Stage, seed: number): string {
  const variants = VARIANTS_BY_STAGE[stage];
  // Use unsigned modulo so negative seeds don't pick out-of-bounds.
  const idx = ((seed >>> 0) + (stage * 17)) % variants.length;
  return variants[idx]!;
}
