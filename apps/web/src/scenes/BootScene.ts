import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    this.load.image("plane", "assets/plane.png");

    // Obstacles
    this.load.image("top_pillar", "assets/obstacles/top_pillar.png");
    this.load.image("bottom_pillar", "assets/obstacles/bottom_pillar.png");
    this.load.image("bird_small", "assets/obstacles/bird_small.png");
    this.load.image("bird_big", "assets/obstacles/bird_big.png");
    this.load.image("drone", "assets/obstacles/drone.png");
    this.load.image("jet", "assets/obstacles/jet.png");
    this.load.image("ufo", "assets/obstacles/ufo.png");
    this.load.spritesheet("missiles", "assets/obstacles/missiles.png", {
      frameWidth: 591,
      frameHeight: 222,
    });

    // Pickups
    this.load.image("fuel_token", "assets/boosts/fuel_token.png");

    // Backgrounds — all 8 variants for the per-stage mood picker
    this.load.image("bg_blue_sky", "assets/backgrounds/blue_sky.png");
    this.load.image("bg_blue_sky_mountain", "assets/backgrounds/blue_sky_mountain.png");
    this.load.image("bg_sunset", "assets/backgrounds/sunset.png");
    this.load.image("bg_dusk", "assets/backgrounds/dusk.png");
    this.load.image("bg_night_clear", "assets/backgrounds/night_clear.png");
    this.load.image("bg_night_cloudy", "assets/backgrounds/night_cloudy.png");
    this.load.image("bg_night_cloudy_moon", "assets/backgrounds/night_cloudy_moon.png");
    this.load.image("bg_night_stormy", "assets/backgrounds/night_stormy.png");
  }

  create(): void {
    this.scene.start("PlayScene");
  }
}
