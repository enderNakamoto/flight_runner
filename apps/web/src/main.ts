import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@flight/sim";
import { BootScene } from "./scenes/BootScene.js";
import { PlayScene } from "./scenes/PlayScene.js";
import { mountWalletPanel } from "./ui/wallet-panel.js";

// Mount the wallet panel before Phaser boots — DOM overlay sibling, not
// part of the canvas. Slice 5b: Connect Wallet + Start On-Chain Run.
const chainPanelEl = document.getElementById("chain-panel");
if (chainPanelEl) mountWalletPanel(chainPanelEl);

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
