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
    this.load.spritesheet("bird_small_flap", "assets/obstacles/bird_small_flap.png", { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet("bird_big_flap", "assets/obstacles/bird_big_flap.png", { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet("propeller_plane", "assets/obstacles/propeller_plane.png", { frameWidth: 96, frameHeight: 96 });

    // Plume flicker — fiery exhaust shown behind jets and missiles.
    this.load.spritesheet("plume_flicker", "assets/effects/plume.png", { frameWidth: 96, frameHeight: 96 });
    // Smoke drift — soft gray trail shown behind the player plane.
    this.load.spritesheet("smoke_drift", "assets/effects/smoke.png", { frameWidth: 96, frameHeight: 96 });
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
    // true alpha=0 transparency. Strip the background colour at boot time so
    // they composite cleanly over the sky.
    //
    // Method: flood-fill from the texture edges. Pixels matching the corner
    // colour AND connected to the edge get alpha=0. Pixels matching the
    // colour but *enclosed* inside the sprite (e.g. a grey pixel surrounded by
    // opaque missile trail) stay opaque — that's what prevented the checker-
    // pattern artifact a tolerance-strip produced on the missiles sheet.
    this.stripBackground("fuel_token", { isSpriteSheet: false, tolerance: 18 });
    this.stripBackground("drone",      { isSpriteSheet: false, tolerance: 18 });
    this.stripBackground("jet",        { isSpriteSheet: false, tolerance: 18 });
    this.stripBackground("missiles",   { isSpriteSheet: true,  tolerance: 14, frameWidth: 591, frameHeight: 222 });

    // Propeller_plane (used by the towed banner planes) has hard-edged
    // dark blade shapes per frame — when the animation plays, the blade
    // in certain rotations looks like a sharp vertical line flickering
    // on/off. Soften the blade-area pixels to ~40 % alpha so the spin
    // reads as motion blur instead of discrete bars.
    this.softenPropellerBlade("propeller_plane", { frameWidth: 96, frameHeight: 96, discStartX: 13, targetAlpha: 110 });

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

    // Flood-fill from every edge pixel: only edge-connected bg pixels are made
    // transparent. Iterative BFS using a flat Int32Array stack to keep GC and
    // allocator pressure off — the spritesheet alone is ~1.5M pixels.
    const matches = (idx: number): boolean =>
      Math.abs(px[idx]! - bgR) <= tol &&
      Math.abs(px[idx + 1]! - bgG) <= tol &&
      Math.abs(px[idx + 2]! - bgB) <= tol;
    const visited = new Uint8Array(W * H);
    const stack: number[] = [];
    const seed = (x: number, y: number): void => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const flat = y * W + x;
      if (visited[flat]) return;
      if (!matches(flat * 4)) return;
      visited[flat] = 1;
      stack.push(flat);
    };
    for (let x = 0; x < W; x++) {
      seed(x, 0);
      seed(x, H - 1);
    }
    for (let y = 0; y < H; y++) {
      seed(0, y);
      seed(W - 1, y);
    }
    while (stack.length > 0) {
      const flat = stack.pop()!;
      const x = flat % W;
      const y = Math.floor(flat / W);
      px[flat * 4 + 3] = 0;
      seed(x + 1, y);
      seed(x - 1, y);
      seed(x, y + 1);
      seed(x, y - 1);
    }

    ctx.putImageData(imageData, 0, 0);

    this.textures.remove(key);
    if (opts.isSpriteSheet) {
      // Register the canvas as a texture, then explicitly slice it into
      // spritesheet frames. (Phaser.addSpriteSheet expects an HTMLImageElement
      // and the canvas-as-source path is fragile.)
      const tex = this.textures.addCanvas(key, canvas);
      if (tex) {
        const fw = opts.frameWidth!;
        const fh = opts.frameHeight!;
        const cols = Math.floor(W / fw);
        const rows = Math.floor(H / fh);
        let frameIdx = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            tex.add(frameIdx, 0, c * fw, r * fh, fw, fh);
            frameIdx++;
          }
        }
      }
    } else {
      this.textures.addCanvas(key, canvas);
    }
  }

  /// Fade hard-edged "propeller blade" pixels in a propeller-plane
  /// spritesheet down to a lower alpha so the spin animation looks like
  /// motion blur rather than a flickering black line. Only touches
  /// columns at or past `discStartX` (the area in front of the plane's
  /// nose), so the plane body itself is preserved.
  private softenPropellerBlade(
    key: string,
    opts: { frameWidth: number; frameHeight: number; discStartX: number; targetAlpha: number },
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

    const fw = opts.frameWidth;
    const fh = opts.frameHeight;
    const cols = Math.floor(W / fw);
    const DARK_BRIGHTNESS = 80; // RGB max below this counts as "blade"

    for (let f = 0; f < cols; f++) {
      for (let fy = 0; fy < fh; fy++) {
        for (let fx = opts.discStartX; fx < fw; fx++) {
          const idx = ((fy * W) + (f * fw + fx)) * 4;
          const a = px[idx + 3]!;
          const r = px[idx]!;
          const g = px[idx + 1]!;
          const b = px[idx + 2]!;
          if (a > 128 && Math.max(r, g, b) < DARK_BRIGHTNESS) {
            px[idx + 3] = opts.targetAlpha;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Re-register the spritesheet so Phaser picks up the modified canvas.
    this.textures.remove(key);
    const newTex = this.textures.addCanvas(key, canvas);
    if (newTex) {
      let frameIdx = 0;
      const rows = Math.floor(H / fh);
      const colsActual = Math.floor(W / fw);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < colsActual; c++) {
          newTex.add(frameIdx, 0, c * fw, r * fh, fw, fh);
          frameIdx++;
        }
      }
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
