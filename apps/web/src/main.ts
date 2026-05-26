// Routing:
//   /                      → landing page (lists games)
//   /flight_scroll         → the flight_scroll Phaser game
//   /<other_game_slug>     → 404 → falls back to landing
//
// A direct link straight to a game slug skips the landing entirely.

import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@flight/sim";
import { findGame } from "./landing/games.js";
import { mountLanding } from "./landing/landing.js";
import { BootScene } from "./scenes/BootScene.js";
import { PlayScene } from "./scenes/PlayScene.js";
import { mountSubmitUI } from "./ui/submit-ui.js";

const path = window.location.pathname.replace(/^\/+|\/+$/g, ""); // trim slashes
const game = findGame(path);

if (game?.slug === "flight_scroll") {
  // Boot the game. Submit overlay listens for game-over events and
  // renders itself lazily.
  mountSubmitUI();

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#1a2735",
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, PlayScene],
  });
} else {
  // Anything else — landing.
  mountLanding();
}
