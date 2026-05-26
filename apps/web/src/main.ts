// Routing:
//   /                              → landing page
//   /leaderboard                   → all-games leaderboard index
//   /<slug>                        → that game (only flight_scroll today)
//   /<slug>/leaderboard            → that game's leaderboard
//   anything else                  → falls through to landing
//
// Direct links to /<slug> skip the landing entirely.

import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@flight/sim";
import { startScoreSync } from "./chain/score-sync.js";
import { restoreWallet } from "./chain/wallet.js";
import { findGame } from "./landing/games.js";
import { mountHowItWorks } from "./landing/how-it-works.js";
import { mountLanding } from "./landing/landing.js";
import { mountAllLeaderboards, mountGameLeaderboard } from "./landing/leaderboard.js";
import { BootScene } from "./scenes/BootScene.js";
import { PlayScene } from "./scenes/PlayScene.js";
import { mountBackLink } from "./ui/back-link.js";
import { mountSubmitUI } from "./ui/submit-ui.js";

// Subscribe globally: whenever a wallet connects (silent restore on
// page load OR explicit user sign-in), mirror the player's on-chain
// best scores to localStorage so cross-browser sessions show the right
// in-HUD BEST overlay. The chain remains the source of truth.
startScoreSync();

// Silent reconnect of a previously-chosen wallet — doesn't open the
// picker, just re-attaches if the user already authorized the site.
// Runs in parallel with page mount; the UI subscribes to wallet
// changes and updates if/when the address comes back.
restoreWallet();

const segments = window.location.pathname.split("/").filter(Boolean);

function bootGame() {
  mountBackLink();
  mountSubmitUI();
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: "#1a2735",
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, PlayScene],
  });
}

if (segments.length === 0) {
  mountLanding();
} else if (segments.length === 1 && segments[0] === "leaderboard") {
  mountAllLeaderboards();
} else if (segments.length === 1 && segments[0] === "how-it-works") {
  mountHowItWorks();
} else if (segments.length === 1) {
  const game = findGame(segments[0]!);
  if (game && game.status === "live") bootGame();
  else mountLanding();
} else if (segments.length === 2 && segments[1] === "leaderboard") {
  const game = findGame(segments[0]!);
  if (game) mountGameLeaderboard(game);
  else mountLanding();
} else {
  mountLanding();
}
