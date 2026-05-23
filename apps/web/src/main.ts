import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@flight/sim";
import { BootScene } from "./scenes/BootScene.js";
import { PlayScene } from "./scenes/PlayScene.js";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: "#1a2735",
  pixelArt: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PlayScene],
});
