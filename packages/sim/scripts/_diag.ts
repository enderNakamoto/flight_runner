import { readFileSync } from "node:fs";
import {
  createInitialState,
  decodeTranscript,
  stepMut,
  STAGE_NAMES,
  Stage,
  GameOverReason,
} from "../src/index.js";

const path = process.argv[2]!;
const buf = new Uint8Array(readFileSync(path));
const { seed, buttons } = decodeTranscript(buf);

// Replay tick-by-tick, log state at score milestones, enemy spawns, and on death.
for (const startStage of [Stage.Common, Stage.Uncommon, Stage.Rare, Stage.Legendary, Stage.Mythical]) {
  const state = createInitialState(seed, startStage);
  let lastEnemyCount = 0;
  let lastScore = 0;
  for (let i = 0; i < buttons.length; i++) {
    stepMut(state, { buttons: buttons[i]! });
    if (state.enemies.length > lastEnemyCount) {
      const e = state.enemies[state.enemies.length - 1]!;
      // first 3 spawns per stage start
      if (i < 1000) {
        console.log(`  [${STAGE_NAMES[startStage]}] tick ${i}: spawn kind=${e.kind} y=${e.y.toFixed(0)} vx=${e.vx.toFixed(2)}`);
      }
      lastEnemyCount = state.enemies.length;
    }
    if (state.score !== lastScore) {
      if (state.score % 20 === 0 || state.score === 1) {
        console.log(`  [${STAGE_NAMES[startStage]}] tick ${i}: score=${state.score} stage=${STAGE_NAMES[state.stage]}`);
      }
      lastScore = state.score;
    }
    if (state.gameOver) {
      console.log(`[${STAGE_NAMES[startStage]}] DIED tick=${i} score=${state.score} stage=${STAGE_NAMES[state.stage]} reason=${GameOverReason[state.gameOverReason]}`);
      break;
    }
  }
  if (!state.gameOver) console.log(`[${STAGE_NAMES[startStage]}] survived ${buttons.length} ticks, final score ${state.score}`);
}
