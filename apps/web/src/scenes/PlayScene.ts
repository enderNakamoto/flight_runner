import Phaser from "phaser";
import {
  BTN_DOWN,
  BTN_UP,
  PILLAR_BOT_GAP_PAD_SRC,
  PILLAR_GAP,
  PILLAR_HITBOX_W,
  PILLAR_SRC_H,
  PILLAR_TOP_GAP_PAD_SRC,
  PILLAR_WIDTH,
  PLANE_HITBOX_H,
  PLANE_HITBOX_W,
  PLANE_X,
  TICK_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createInitialState,
  stepMut,
  type GameState,
} from "@flight/sim";

interface PillarSprites {
  top: Phaser.GameObjects.Image;
  bottom: Phaser.GameObjects.Image;
}

type Phase = "ready" | "playing" | "gameOver";

const BEST_SCORE_KEY = "flight_scroll:best";

interface PillarSnap {
  id: number;
  x: number;
  gapY: number;
  passed: boolean;
}

interface TestHooks {
  ready: boolean;
  phase: () => Phase;
  state: () => {
    phase: Phase;
    tick: number;
    score: number;
    gameOver: boolean;
    plane: { y: number; vy: number };
    pillars: PillarSnap[];
    best: number;
  };
  constants: () => {
    PLANE_X: number;
    PLANE_HITBOX_W: number;
    PLANE_HITBOX_H: number;
    PILLAR_WIDTH: number;
    PILLAR_HITBOX_W: number;
    PILLAR_SRC_H: number;
    PILLAR_TOP_GAP_PAD_SRC: number;
    PILLAR_BOT_GAP_PAD_SRC: number;
    PILLAR_GAP: number;
    WORLD_WIDTH: number;
    WORLD_HEIGHT: number;
  };
}

declare global {
  interface Window {
    __TEST__?: TestHooks;
  }
}

function testEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("test") === "1";
  } catch {
    return false;
  }
}

function debugEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

export class PlayScene extends Phaser.Scene {
  private state!: GameState;
  private accumulator = 0;
  private phase: Phase = "ready";
  private best = 0;

  private bg!: Phaser.GameObjects.TileSprite;
  private planeSprite!: Phaser.GameObjects.Image;
  private pillarSprites = new Map<number, PillarSprites>();
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private stageText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  private keyUp!: Phaser.Input.Keyboard.Key;
  private keyDown!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;

  private debug = false;
  private debugGfx?: Phaser.GameObjects.Graphics;

  constructor() {
    super("PlayScene");
  }

  create(): void {
    this.state = createInitialState(this.makeSeed());
    this.accumulator = 0;
    this.phase = "ready";
    this.best = this.loadBest();

    this.bg = this.add
      .tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, "bg_blue_sky")
      .setOrigin(0, 0);

    this.planeSprite = this.add.image(PLANE_X, this.state.plane.y, "plane");
    this.planeSprite.setDisplaySize(96, 48);

    this.scoreText = this.add
      .text(24, 18, "0", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "48px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setDepth(10);

    this.bestText = this.add
      .text(24, 78, this.formatBest(), {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "18px",
        color: "#cfd8dc",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setDepth(10);

    this.stageText = this.add
      .text(WORLD_WIDTH - 24, 24, "COMMON", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "22px",
        color: "#b0bec5",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(1, 0)
      .setDepth(10);

    this.statusText = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 20, "PRESS ↑ / ↓\nTO FLY", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "56px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 8,
        align: "center",
      })
      .setOrigin(0.5)
      .setLineSpacing(8)
      .setDepth(10);

    this.hintText = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 36, "↑ / ↓ to steer", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "20px",
        color: "#dddddd",
      })
      .setOrigin(0.5, 1)
      .setDepth(10);

    const kb = this.input.keyboard!;
    this.keyUp = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);

    kb.on("keydown-UP", () => this.onSteerPressed());
    kb.on("keydown-DOWN", () => this.onSteerPressed());
    kb.on("keydown-W", () => this.onSteerPressed());
    kb.on("keydown-S", () => this.onSteerPressed());
    kb.on("keydown-SPACE", () => this.onSteerPressed());
    kb.on("keydown-R", () => this.maybeRestart());

    this.debug = debugEnabled();
    if (this.debug) {
      this.debugGfx = this.add.graphics().setDepth(20);
    }

    if (testEnabled()) {
      window.__TEST__ = {
        ready: true,
        phase: () => this.phase,
        state: () => ({
          phase: this.phase,
          tick: this.state.tick,
          score: this.state.score,
          gameOver: this.state.gameOver,
          plane: { y: this.state.plane.y, vy: this.state.plane.vy },
          pillars: this.state.pillars.map((p) => ({
            id: p.id,
            x: p.x,
            gapY: p.gapY,
            passed: p.passed,
          })),
          best: this.best,
        }),
        constants: () => ({
          PLANE_X,
          PLANE_HITBOX_W,
          PLANE_HITBOX_H,
          PILLAR_WIDTH,
          PILLAR_HITBOX_W,
          PILLAR_SRC_H,
          PILLAR_TOP_GAP_PAD_SRC,
          PILLAR_BOT_GAP_PAD_SRC,
          PILLAR_GAP,
          WORLD_WIDTH,
          WORLD_HEIGHT,
        }),
      };
    }
  }

  override update(_time: number, delta: number): void {
    if (this.phase === "playing") {
      this.accumulator += delta;
      let safety = 6;
      while (this.accumulator >= TICK_MS && safety-- > 0) {
        this.accumulator -= TICK_MS;
        stepMut(this.state, { buttons: this.readButtons() });
        if (this.state.gameOver) {
          this.phase = "gameOver";
          this.commitBest();
          break;
        }
      }
    }
    this.render(delta);
  }

  private readButtons(): number {
    let b = 0;
    if (this.keyUp.isDown || this.keyW.isDown) b |= BTN_UP;
    if (this.keyDown.isDown || this.keyS.isDown) b |= BTN_DOWN;
    return b;
  }

  private render(delta: number): void {
    if (this.phase === "ready") {
      this.bg.tilePositionX += delta * 0.04;
      this.planeSprite.y =
        this.state.plane.y + Math.sin(this.time.now / 220) * 6;
      this.planeSprite.setRotation(0);
    } else {
      this.bg.tilePositionX = this.state.tick * 1.5;
      this.planeSprite.y = this.state.plane.y;
      this.planeSprite.setRotation(
        Phaser.Math.Clamp(this.state.plane.vy / 12, -0.45, 0.45),
      );
    }

    const seen = new Set<number>();
    for (const p of this.state.pillars) {
      seen.add(p.id);
      let sprites = this.pillarSprites.get(p.id);
      if (!sprites) {
        const top = this.add
          .image(p.x + PILLAR_WIDTH / 2, p.gapY - PILLAR_GAP / 2, "top_pillar")
          .setOrigin(0.5, 1);
        top.setDisplaySize(PILLAR_WIDTH, p.gapY - PILLAR_GAP / 2);

        const bottom = this.add
          .image(p.x + PILLAR_WIDTH / 2, p.gapY + PILLAR_GAP / 2, "bottom_pillar")
          .setOrigin(0.5, 0);
        bottom.setDisplaySize(PILLAR_WIDTH, WORLD_HEIGHT - (p.gapY + PILLAR_GAP / 2));

        sprites = { top, bottom };
        this.pillarSprites.set(p.id, sprites);
      }
      sprites.top.x = p.x + PILLAR_WIDTH / 2;
      sprites.bottom.x = p.x + PILLAR_WIDTH / 2;
    }

    for (const [id, sprites] of this.pillarSprites) {
      if (!seen.has(id)) {
        sprites.top.destroy();
        sprites.bottom.destroy();
        this.pillarSprites.delete(id);
      }
    }

    if (this.debug && this.debugGfx) {
      this.drawDebug();
    }

    this.scoreText.setText(String(this.state.score));
    this.bestText.setText(this.formatBest());

    if (this.phase === "ready") {
      this.statusText.setText("PRESS ↑ / ↓\nTO FLY");
      this.statusText.setColor("#ffffff");
      this.hintText.setText("↑ / ↓ to steer");
    } else if (this.phase === "gameOver") {
      const headline =
        this.state.score > 0 && this.state.score >= this.best
          ? `GAME OVER\nNEW BEST ${this.state.score}`
          : `GAME OVER\nSCORE ${this.state.score}`;
      this.statusText.setText(headline);
      this.statusText.setColor("#ff5252");
      this.hintText.setText("R to restart");
    } else {
      this.statusText.setText("");
      this.hintText.setText("↑ / ↓ to steer");
    }
  }

  private drawDebug(): void {
    const g = this.debugGfx!;
    g.clear();

    // Plane hitbox (green when alive, red when gameOver)
    const alive = !this.state.gameOver;
    g.lineStyle(2, alive ? 0x00ff00 : 0xff0000, 1);
    g.strokeRect(
      PLANE_X - PLANE_HITBOX_W / 2,
      this.state.plane.y - PLANE_HITBOX_H / 2,
      PLANE_HITBOX_W,
      PLANE_HITBOX_H,
    );

    // Pillar hitboxes — the actual sim collision rects (inset from the sprite,
    // with per-pillar vertical inset proportional to displayed height).
    const insetX = (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2;
    for (const p of this.state.pillars) {
      const visGapTop = p.gapY - PILLAR_GAP / 2;
      const visGapBottom = p.gapY + PILLAR_GAP / 2;
      const topPillarH = visGapTop;
      const botPillarH = WORLD_HEIGHT - visGapBottom;
      const topInset = (topPillarH * PILLAR_TOP_GAP_PAD_SRC) / PILLAR_SRC_H;
      const botInset = (botPillarH * PILLAR_BOT_GAP_PAD_SRC) / PILLAR_SRC_H;
      const hitGapTop = visGapTop - topInset;
      const hitGapBottom = visGapBottom + botInset;

      // Sprite bounds (dim) — to compare hitbox against the visible sprite
      g.lineStyle(1, 0xffffff, 0.25);
      g.strokeRect(p.x, 0, PILLAR_WIDTH, visGapTop);
      g.strokeRect(p.x, visGapBottom, PILLAR_WIDTH, WORLD_HEIGHT - visGapBottom);

      // Hitboxes (yellow, solid)
      g.lineStyle(2, 0xffd400, 1);
      g.strokeRect(p.x + insetX, 0, PILLAR_HITBOX_W, hitGapTop);
      g.strokeRect(
        p.x + insetX,
        hitGapBottom,
        PILLAR_HITBOX_W,
        WORLD_HEIGHT - hitGapBottom,
      );

      // Effective gap (cyan)
      g.lineStyle(1, 0x00e5ff, 0.7);
      g.strokeRect(p.x + insetX, hitGapTop, PILLAR_HITBOX_W, hitGapBottom - hitGapTop);
    }
  }

  private onSteerPressed(): void {
    if (this.phase === "ready") {
      this.phase = "playing";
      this.accumulator = 0;
    }
  }

  private maybeRestart(): void {
    if (this.phase !== "gameOver") return;
    for (const sprites of this.pillarSprites.values()) {
      sprites.top.destroy();
      sprites.bottom.destroy();
    }
    this.pillarSprites.clear();
    this.scene.restart();
  }

  private makeSeed(): number {
    return (Date.now() & 0xffffffff) | 0;
  }

  private loadBest(): number {
    try {
      const raw = window.localStorage.getItem(BEST_SCORE_KEY);
      const n = raw === null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private commitBest(): void {
    if (this.state.score <= this.best) return;
    this.best = this.state.score;
    try {
      window.localStorage.setItem(BEST_SCORE_KEY, String(this.best));
    } catch {
      // localStorage unavailable (private mode etc.) — keep in-memory only
    }
  }

  private formatBest(): string {
    return `BEST ${this.best}`;
  }
}
