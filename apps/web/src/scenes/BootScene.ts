import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    this.load.image("plane", "assets/plane.png");
    this.load.image("top_pillar", "assets/obstacles/top_pillar.png");
    this.load.image("bottom_pillar", "assets/obstacles/bottom_pillar.png");
    this.load.image("bg_blue_sky", "assets/backgrounds/blue_sky.png");
  }

  create(): void {
    this.scene.start("PlayScene");
  }
}
