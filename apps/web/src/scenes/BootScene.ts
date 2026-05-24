import Phaser from "phaser";

const BG_KEYS = [
  "bg_blue_sky",
  "bg_blue_sky_mountain",
  "bg_sunset",
  "bg_dusk",
  "bg_night_clear",
  "bg_night_cloudy",
  "bg_night_cloudy_moon",
  "bg_night_stormy",
] as const;

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
    // Several assets were saved with opaque light-grey backgrounds instead of
    // true alpha=0 transparency. Strip the background colour by chroma-key at
    // boot time so they composite cleanly over the sky.
    this.stripBackground("fuel_token", { isSpriteSheet: false, tolerance: 15 });
    this.stripBackground("drone",      { isSpriteSheet: false, tolerance: 15 });
    this.stripBackground("jet",        { isSpriteSheet: false, tolerance: 15 });
    // Missiles spritesheet has a white-bodied frame ("missile_white_red_fin");
    // use a tight tolerance so we don't punch holes in the white missile.
    this.stripBackground("missiles", { isSpriteSheet: true, tolerance: 5, frameWidth: 591, frameHeight: 222 });

    // The bg PNGs aren't tileable horizontally (their left and right edges
    // don't match), so a scrolling tileSprite shows a vertical seam every time
    // tilePositionX crosses the texture width. Compose each with a
    // horizontally-mirrored copy → 2W×H ping-pong texture, seamless when tiled.
    for (const key of BG_KEYS) {
      this.makeSeamless(key);
    }
    this.scene.start("PlayScene");
  }

  private stripBackground(
    key: string,
    opts: { isSpriteSheet: boolean; tolerance: number; frameWidth?: number; frameHeight?: number },
  ): void {
    const tex = this.textures.get(key);
    if (!tex || tex.key === "__MISSING") return;
    const img = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const W = img.width;
    const H = img.height;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, W, H);
    const px = imageData.data;

    // Sample corner pixel as the background colour. This is the asset's actual
    // background — measured via tests/token_pixels.mjs for the four bad PNGs.
    const bgR = px[0]!;
    const bgG = px[1]!;
    const bgB = px[2]!;
    const tol = opts.tolerance;
    for (let i = 0; i < px.length; i += 4) {
      if (
        Math.abs(px[i]! - bgR) <= tol &&
        Math.abs(px[i + 1]! - bgG) <= tol &&
        Math.abs(px[i + 2]! - bgB) <= tol
      ) {
        px[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    this.textures.remove(key);
    if (opts.isSpriteSheet) {
      this.textures.addSpriteSheet(key, canvas as unknown as HTMLImageElement, {
        frameWidth: opts.frameWidth!,
        frameHeight: opts.frameHeight!,
      });
    } else {
      this.textures.addCanvas(key, canvas);
    }
  }

  private makeSeamless(srcKey: string): void {
    const seamlessKey = `${srcKey}_seamless`;
    if (this.textures.exists(seamlessKey)) return;
    const src = this.textures.get(srcKey);
    if (!src || src.key === "__MISSING") return;
    const img = src.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const w = img.width;
    const h = img.height;

    const canvas = this.textures.createCanvas(seamlessKey, w * 2, h);
    if (!canvas) return;
    const ctx = canvas.context;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    // Mirrored copy at [w, 2w]
    ctx.save();
    ctx.translate(w * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    canvas.refresh();
  }
}
