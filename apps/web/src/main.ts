import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@flight/sim";
import { BootScene } from "./scenes/BootScene.js";
import { PlayScene } from "./scenes/PlayScene.js";
import { mountSubmitUI } from "./ui/submit-ui.js";

// Submit UI lazily renders itself once a transcript is captured at game
// over. No chain-related DOM lives on the page until that happens.
mountSubmitUI();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: "#1a2735",
  // Pixel-art assets — nearest-neighbour filtering removes the white halo
  // that linear filtering would produce around transparent sprite edges.
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PlayScene],
});
