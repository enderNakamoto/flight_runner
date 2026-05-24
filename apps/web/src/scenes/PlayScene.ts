import Phaser from "phaser";
import {
  BIRD_BIG_DISPLAY_H,
  BIRD_BIG_DISPLAY_W,
  BIRD_BIG_HITBOX_H,
  BIRD_BIG_HITBOX_W,
  BIRD_SMALL_DISPLAY_H,
  BIRD_SMALL_DISPLAY_W,
  BIRD_SMALL_HITBOX_H,
  BIRD_SMALL_HITBOX_W,
  BTN_DOWN,
  BTN_UP,
  DRONE_DISPLAY_H,
  DRONE_DISPLAY_W,
  DRONE_HITBOX_H,
  DRONE_HITBOX_W,
  EnemyKind,
  FLICKER_DURATION_TICKS,
  FLICKER_PERIOD_TICKS,
  FUEL_MAX,
  FUEL_TOKEN_DISPLAY,
  FUEL_TOKEN_HITBOX,
  JET_DISPLAY_H,
  JET_DISPLAY_W,
  JET_HITBOX_H,
  JET_HITBOX_W,
  MISSILE_DISPLAY_H,
  MISSILE_DISPLAY_W,
  MISSILE_HITBOX_H,
  MISSILE_HITBOX_W,
  PILLAR_BOT_GAP_PAD_SRC,
  PILLAR_GAP,
  PILLAR_HITBOX_W,
  PILLAR_SRC_H,
  PILLAR_TOP_GAP_PAD_SRC,
  PILLAR_WIDTH,
  PLANE_HITBOX_H,
  PLANE_HITBOX_W,
  PLANE_X,
  STAGE_NAMES,
  STAGE_TABLE,
  Stage,
  TICK_MS,
  UFO_DISPLAY_H,
  UFO_DISPLAY_W,
  UFO_HITBOX_H,
  UFO_HITBOX_W,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createInitialState,
  stepMut,
  type GameState,
} from "@flight/sim";
import { backgroundFor } from "../backgrounds.js";

interface PillarSprites {
  top: Phaser.GameObjects.Image;
  bottom: Phaser.GameObjects.Image;
}

type Phase = "ready" | "playing" | "gameOver";

const BEST_SCORE_KEY = "flight_scroll:best";

interface PillarSnap { id: number; x: number; gapY: number; passed: boolean }
interface EnemySnap { id: number; kind: number; x: number; y: number; vx: number; passed: boolean }
interface MissileSnap { id: number; tier: number; frame: number; x: number; y: number; vx: number }
interface FuelTokenSnap { id: number; x: number; y: number }

interface TestHooks {
  ready: boolean;
  phase: () => Phase;
  state: () => {
    phase: Phase;
    tick: number;
    score: number;
    gameOver: boolean;
    stage: number;
    fuel: number;
    plane: { y: number; vy: number };
    pillars: PillarSnap[];
    enemies: EnemySnap[];
    missiles: MissileSnap[];
    fuelTokens: FuelTokenSnap[];
    best: number;
  };
  constants: () => Record<string, number>;
}

declare global {
  interface Window { __TEST__?: TestHooks }
}

function getParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); }
  catch { return null; }
}
function testEnabled(): boolean { return getParam("test") === "1"; }
function debugEnabled(): boolean { return getParam("debug") === "1"; }
function startStageFromUrl(): Stage {
  const raw = getParam("stage");
  if (raw === null) return Stage.Common;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n >= STAGE_TABLE.length) return Stage.Common;
  return n as Stage;
}

interface EnemySpec {
  displayW: number; displayH: number;
  hitboxW: number; hitboxH: number;
  texture: string; flipX: boolean;
}

const ENEMY_SPEC: Record<EnemyKind, EnemySpec> = {
  [EnemyKind.BirdSmall]: { displayW: BIRD_SMALL_DISPLAY_W, displayH: BIRD_SMALL_DISPLAY_H, hitboxW: BIRD_SMALL_HITBOX_W, hitboxH: BIRD_SMALL_HITBOX_H, texture: "bird_small", flipX: false },
  [EnemyKind.BirdBig]:   { displayW: BIRD_BIG_DISPLAY_W,   displayH: BIRD_BIG_DISPLAY_H,   hitboxW: BIRD_BIG_HITBOX_W,   hitboxH: BIRD_BIG_HITBOX_H,   texture: "bird_big",   flipX: true  },
  [EnemyKind.Drone]:     { displayW: DRONE_DISPLAY_W,      displayH: DRONE_DISPLAY_H,      hitboxW: DRONE_HITBOX_W,      hitboxH: DRONE_HITBOX_H,      texture: "drone",      flipX: true  },
  [EnemyKind.Jet]:       { displayW: JET_DISPLAY_W,        displayH: JET_DISPLAY_H,        hitboxW: JET_HITBOX_W,        hitboxH: JET_HITBOX_H,        texture: "jet",        flipX: false },
  [EnemyKind.Ufo]:       { displayW: UFO_DISPLAY_W,        displayH: UFO_DISPLAY_H,        hitboxW: UFO_HITBOX_W,        hitboxH: UFO_HITBOX_H,        texture: "ufo",        flipX: false },
};

export class PlayScene extends Phaser.Scene {
  private state!: GameState;
  private accumulator = 0;
  private phase: Phase = "ready";
  private best = 0;
  private seed = 0;

  private bg!: Phaser.GameObjects.TileSprite;
  private bgFading: Phaser.GameObjects.TileSprite | null = null;
  private flickerOverlay!: Phaser.GameObjects.Rectangle;

  private planeSprite!: Phaser.GameObjects.Image;
  private pillarSprites = new Map<number, PillarSprites>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  private missileSprites = new Map<number, Phaser.GameObjects.Image>();
  private fuelTokenSprites = new Map<number, Phaser.GameObjects.Image>();

  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private stageText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private fuelBarBg!: Phaser.GameObjects.Rectangle;
  private fuelBarFill!: Phaser.GameObjects.Rectangle;
  private fuelLabel!: Phaser.GameObjects.Text;

  private keyUp!: Phaser.Input.Keyboard.Key;
  private keyDown!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;

  private debug = false;
  private debugGfx?: Phaser.GameObjects.Graphics;

  constructor() { super("PlayScene"); }

  create(): void {
    this.seed = this.makeSeed();
    this.state = createInitialState(this.seed, startStageFromUrl());
    this.accumulator = 0;
    this.phase = "ready";
    this.best = this.loadBest();

    this.bg = this.add
      .tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, backgroundFor(this.state.stage as Stage, this.seed))
      .setOrigin(0, 0)
      .setDepth(0);

    this.flickerOverlay = this.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0xffffff, 0)
      .setOrigin(0, 0)
      .setDepth(15);

    this.planeSprite = this.add.image(PLANE_X, this.state.plane.y, "plane").setDepth(6);
    this.planeSprite.setDisplaySize(96, 48);

    this.scoreText = this.add
      .text(24, 18, "0", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "48px", color: "#ffffff", stroke: "#000000", strokeThickness: 6 })
      .setDepth(10);

    this.bestText = this.add
      .text(24, 78, this.formatBest(), { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "18px", color: "#cfd8dc", stroke: "#000000", strokeThickness: 4 })
      .setDepth(10);

    this.stageText = this.add
      .text(WORLD_WIDTH - 24, 24, STAGE_NAMES[this.state.stage]!, { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "22px", color: "#b0bec5", stroke: "#000000", strokeThickness: 5 })
      .setOrigin(1, 0)
      .setDepth(10);

    // Fuel bar — under the stage badge on the right.
    const BAR_W = 200, BAR_H = 14, BAR_X = WORLD_WIDTH - 24 - BAR_W, BAR_Y = 64;
    this.fuelBarBg = this.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, 0x000000, 0.45)
      .setOrigin(0, 0).setDepth(10).setStrokeStyle(2, 0xffffff, 0.6);
    this.fuelBarFill = this.add.rectangle(BAR_X + 2, BAR_Y + 2, BAR_W - 4, BAR_H - 4, 0x4caf50, 1)
      .setOrigin(0, 0).setDepth(10);
    this.fuelLabel = this.add.text(BAR_X, BAR_Y + BAR_H + 2, "FUEL", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "12px", color: "#cfd8dc", stroke: "#000000", strokeThickness: 3 })
      .setDepth(10);

    this.statusText = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 20, "PRESS ↑ / ↓\nTO FLY", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "56px", color: "#ffffff", stroke: "#000000", strokeThickness: 8, align: "center" })
      .setOrigin(0.5).setLineSpacing(8).setDepth(10);

    this.hintText = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 36, "↑ / ↓ to steer", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "20px", color: "#dddddd" })
      .setOrigin(0.5, 1).setDepth(10);

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
          stage: this.state.stage,
          fuel: this.state.fuel,
          plane: { y: this.state.plane.y, vy: this.state.plane.vy },
          pillars: this.state.pillars.map((p) => ({ id: p.id, x: p.x, gapY: p.gapY, passed: p.passed })),
          enemies: this.state.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, vx: e.vx, passed: e.passed })),
          missiles: this.state.missiles.map((m) => ({ id: m.id, tier: m.tier, frame: m.frame, x: m.x, y: m.y, vx: m.vx })),
          fuelTokens: this.state.fuelTokens.map((t) => ({ id: t.id, x: t.x, y: t.y })),
          best: this.best,
        }),
        constants: () => ({
          PLANE_X, PLANE_HITBOX_W, PLANE_HITBOX_H,
          PILLAR_WIDTH, PILLAR_HITBOX_W, PILLAR_SRC_H, PILLAR_TOP_GAP_PAD_SRC, PILLAR_BOT_GAP_PAD_SRC, PILLAR_GAP,
          BIRD_SMALL_HITBOX_W, BIRD_SMALL_HITBOX_H, BIRD_BIG_HITBOX_W, BIRD_BIG_HITBOX_H,
          DRONE_HITBOX_W, DRONE_HITBOX_H, JET_HITBOX_W, JET_HITBOX_H, UFO_HITBOX_W, UFO_HITBOX_H,
          MISSILE_HITBOX_W, MISSILE_HITBOX_H,
          FUEL_TOKEN_HITBOX, FUEL_MAX,
          WORLD_WIDTH, WORLD_HEIGHT,
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
        if (this.state.stageJustChanged) this.onStageChanged();
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

  private onStageChanged(): void {
    this.stageText.setText(STAGE_NAMES[this.state.stage]!);
    this.tweens.add({ targets: this.stageText, scale: { from: 1.6, to: 1 }, duration: 360, ease: "Cubic.easeOut" });

    // Background crossfade — drop the old one to a fading layer, fade it out.
    if (this.bgFading) this.bgFading.destroy();
    this.bgFading = this.bg;
    this.bgFading.setDepth(0);
    this.bg = this.add
      .tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, backgroundFor(this.state.stage as Stage, this.seed))
      .setOrigin(0, 0)
      .setDepth(1)
      .setAlpha(0);
    this.tweens.add({
      targets: this.bg,
      alpha: 1,
      duration: 800,
      onComplete: () => {
        if (this.bgFading) {
          this.bgFading.destroy();
          this.bgFading = null;
        }
        this.bg.setDepth(0);
      },
    });
  }

  private render(delta: number): void {
    if (this.phase === "ready") {
      this.bg.tilePositionX += delta * 0.04;
      this.planeSprite.y = this.state.plane.y + Math.sin(this.time.now / 220) * 6;
      this.planeSprite.setRotation(0);
    } else {
      this.bg.tilePositionX = this.state.tick * 1.5;
      if (this.bgFading) this.bgFading.tilePositionX = this.state.tick * 1.5;
      this.planeSprite.y = this.state.plane.y;
      this.planeSprite.setRotation(Phaser.Math.Clamp(this.state.plane.vy / 12, -0.45, 0.45));
    }

    // ---- Pillars ----
    const seenPillars = new Set<number>();
    for (const p of this.state.pillars) {
      seenPillars.add(p.id);
      let sprites = this.pillarSprites.get(p.id);
      if (!sprites) {
        const top = this.add.image(p.x + PILLAR_WIDTH / 2, p.gapY - PILLAR_GAP / 2, "top_pillar").setOrigin(0.5, 1).setDepth(3);
        top.setDisplaySize(PILLAR_WIDTH, p.gapY - PILLAR_GAP / 2);
        const bottom = this.add.image(p.x + PILLAR_WIDTH / 2, p.gapY + PILLAR_GAP / 2, "bottom_pillar").setOrigin(0.5, 0).setDepth(3);
        bottom.setDisplaySize(PILLAR_WIDTH, WORLD_HEIGHT - (p.gapY + PILLAR_GAP / 2));
        sprites = { top, bottom };
        this.pillarSprites.set(p.id, sprites);
      }
      sprites.top.x = p.x + PILLAR_WIDTH / 2;
      sprites.bottom.x = p.x + PILLAR_WIDTH / 2;
    }
    for (const [id, sprites] of this.pillarSprites) {
      if (!seenPillars.has(id)) {
        sprites.top.destroy(); sprites.bottom.destroy();
        this.pillarSprites.delete(id);
      }
    }

    // ---- Enemies ----
    const seenEnemies = new Set<number>();
    for (const e of this.state.enemies) {
      seenEnemies.add(e.id);
      const spec = ENEMY_SPEC[e.kind as EnemyKind];
      let sprite = this.enemySprites.get(e.id);
      if (!sprite) {
        sprite = this.add.image(e.x, e.y, spec.texture).setDepth(5);
        sprite.setDisplaySize(spec.displayW, spec.displayH);
        sprite.setFlipX(spec.flipX);
        this.enemySprites.set(e.id, sprite);
      }
      sprite.x = e.x; sprite.y = e.y;
    }
    for (const [id, sprite] of this.enemySprites) {
      if (!seenEnemies.has(id)) { sprite.destroy(); this.enemySprites.delete(id); }
    }

    // ---- Missiles ----
    const seenMissiles = new Set<number>();
    for (const m of this.state.missiles) {
      seenMissiles.add(m.id);
      let sprite = this.missileSprites.get(m.id);
      if (!sprite) {
        sprite = this.add.image(m.x, m.y, "missiles", m.frame).setDepth(5);
        sprite.setDisplaySize(MISSILE_DISPLAY_W, MISSILE_DISPLAY_H);
        sprite.setFlipX(true); // missile sprites face right by default; flip to fly left
        this.missileSprites.set(m.id, sprite);
      }
      sprite.x = m.x; sprite.y = m.y;
    }
    for (const [id, sprite] of this.missileSprites) {
      if (!seenMissiles.has(id)) { sprite.destroy(); this.missileSprites.delete(id); }
    }

    // ---- Fuel tokens ----
    const seenTokens = new Set<number>();
    for (const t of this.state.fuelTokens) {
      seenTokens.add(t.id);
      let sprite = this.fuelTokenSprites.get(t.id);
      if (!sprite) {
        sprite = this.add.image(t.x, t.y, "fuel_token").setDepth(4);
        sprite.setDisplaySize(FUEL_TOKEN_DISPLAY, FUEL_TOKEN_DISPLAY);
        this.fuelTokenSprites.set(t.id, sprite);
      }
      sprite.x = t.x; sprite.y = t.y;
      // Spin animation — tween scaleX across [-1, 1] based on time.
      const phase = this.time.now / 280;
      sprite.scaleX = Math.cos(phase) * (FUEL_TOKEN_DISPLAY / sprite.width);
    }
    for (const [id, sprite] of this.fuelTokenSprites) {
      if (!seenTokens.has(id)) { sprite.destroy(); this.fuelTokenSprites.delete(id); }
    }

    // ---- Fuel bar ----
    const stage = STAGE_TABLE[this.state.stage]!;
    if (stage.fuelEnabled) {
      this.fuelBarBg.setVisible(true);
      this.fuelBarFill.setVisible(true);
      this.fuelLabel.setVisible(true);
      const ratio = Math.max(0, Math.min(1, this.state.fuel / FUEL_MAX));
      const fullW = (this.fuelBarBg.width - 4) * ratio;
      this.fuelBarFill.width = fullW;
      const color = ratio > 0.5 ? 0x4caf50 : ratio > 0.2 ? 0xffc107 : 0xff5252;
      this.fuelBarFill.setFillStyle(color, 1);
    } else {
      this.fuelBarBg.setVisible(false);
      this.fuelBarFill.setVisible(false);
      this.fuelLabel.setVisible(false);
    }

    // ---- Mythical flicker ----
    if (stage.visibilityFlicker && this.phase === "playing") {
      const cyc = this.state.tick % FLICKER_PERIOD_TICKS;
      if (cyc < FLICKER_DURATION_TICKS) {
        const t = cyc / FLICKER_DURATION_TICKS;
        // Quick bright flash then darken
        const alpha = t < 0.2 ? 0.85 : 0.45 * (1 - t);
        this.flickerOverlay.setFillStyle(0xffffff, alpha);
      } else {
        this.flickerOverlay.setFillStyle(0xffffff, 0);
      }
    } else {
      this.flickerOverlay.setFillStyle(0xffffff, 0);
    }

    if (this.debug && this.debugGfx) this.drawDebug();

    this.scoreText.setText(String(this.state.score));
    this.bestText.setText(this.formatBest());

    if (this.phase === "ready") {
      this.statusText.setText("PRESS ↑ / ↓\nTO FLY");
      this.statusText.setColor("#ffffff");
      this.hintText.setText("↑ / ↓ to steer");
    } else if (this.phase === "gameOver") {
      const causedByFuel = stage.fuelEnabled && this.state.fuel <= 0;
      const head = causedByFuel
        ? `FUEL OUT\nSCORE ${this.state.score}`
        : this.state.score > 0 && this.state.score >= this.best
          ? `GAME OVER\nNEW BEST ${this.state.score}`
          : `GAME OVER\nSCORE ${this.state.score}`;
      this.statusText.setText(head);
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

    const alive = !this.state.gameOver;
    g.lineStyle(2, alive ? 0x00ff00 : 0xff0000, 1);
    g.strokeRect(PLANE_X - PLANE_HITBOX_W / 2, this.state.plane.y - PLANE_HITBOX_H / 2, PLANE_HITBOX_W, PLANE_HITBOX_H);

    const pInsetX = (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2;
    for (const p of this.state.pillars) {
      const visGapTop = p.gapY - PILLAR_GAP / 2;
      const visGapBottom = p.gapY + PILLAR_GAP / 2;
      const topPillarH = visGapTop;
      const botPillarH = WORLD_HEIGHT - visGapBottom;
      const topInset = (topPillarH * PILLAR_TOP_GAP_PAD_SRC) / PILLAR_SRC_H;
      const botInset = (botPillarH * PILLAR_BOT_GAP_PAD_SRC) / PILLAR_SRC_H;
      const hitGapTop = visGapTop - topInset;
      const hitGapBottom = visGapBottom + botInset;
      g.lineStyle(1, 0xffffff, 0.25);
      g.strokeRect(p.x, 0, PILLAR_WIDTH, visGapTop);
      g.strokeRect(p.x, visGapBottom, PILLAR_WIDTH, WORLD_HEIGHT - visGapBottom);
      g.lineStyle(2, 0xffd400, 1);
      g.strokeRect(p.x + pInsetX, 0, PILLAR_HITBOX_W, hitGapTop);
      g.strokeRect(p.x + pInsetX, hitGapBottom, PILLAR_HITBOX_W, WORLD_HEIGHT - hitGapBottom);
      g.lineStyle(1, 0x00e5ff, 0.7);
      g.strokeRect(p.x + pInsetX, hitGapTop, PILLAR_HITBOX_W, hitGapBottom - hitGapTop);
    }

    g.lineStyle(2, 0xff4dff, 1);
    for (const e of this.state.enemies) {
      const spec = ENEMY_SPEC[e.kind as EnemyKind];
      g.strokeRect(e.x - spec.hitboxW / 2, e.y - spec.hitboxH / 2, spec.hitboxW, spec.hitboxH);
      g.lineStyle(1, 0xffffff, 0.2);
      g.strokeRect(e.x - spec.displayW / 2, e.y - spec.displayH / 2, spec.displayW, spec.displayH);
      g.lineStyle(2, 0xff4dff, 1);
    }

    g.lineStyle(2, 0xff8800, 1);
    for (const m of this.state.missiles) {
      g.strokeRect(m.x - MISSILE_HITBOX_W / 2, m.y - MISSILE_HITBOX_H / 2, MISSILE_HITBOX_W, MISSILE_HITBOX_H);
    }

    g.lineStyle(2, 0x00ff88, 1);
    for (const t of this.state.fuelTokens) {
      g.strokeRect(t.x - FUEL_TOKEN_HITBOX / 2, t.y - FUEL_TOKEN_HITBOX / 2, FUEL_TOKEN_HITBOX, FUEL_TOKEN_HITBOX);
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
    for (const sprites of this.pillarSprites.values()) { sprites.top.destroy(); sprites.bottom.destroy(); }
    this.pillarSprites.clear();
    for (const s of this.enemySprites.values()) s.destroy(); this.enemySprites.clear();
    for (const s of this.missileSprites.values()) s.destroy(); this.missileSprites.clear();
    for (const s of this.fuelTokenSprites.values()) s.destroy(); this.fuelTokenSprites.clear();
    if (this.bgFading) { this.bgFading.destroy(); this.bgFading = null; }
    this.scene.restart();
  }

  private makeSeed(): number { return (Date.now() & 0xffffffff) | 0; }

  private loadBest(): number {
    try {
      const raw = window.localStorage.getItem(BEST_SCORE_KEY);
      const n = raw === null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }

  private commitBest(): void {
    if (this.state.score <= this.best) return;
    this.best = this.state.score;
    try { window.localStorage.setItem(BEST_SCORE_KEY, String(this.best)); } catch {}
  }

  private formatBest(): string { return `BEST ${this.best}`; }
}
