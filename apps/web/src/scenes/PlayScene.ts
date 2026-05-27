import Phaser from "phaser";
import {
  BANNER_PLANE_DISPLAY_H,
  BANNER_PLANE_DISPLAY_W,
  BANNER_PLANE_HITBOX_H,
  BANNER_PLANE_HITBOX_W,
  BIRD_BIG_DISPLAY_H,
  BIRD_BIG_DISPLAY_W,
  BIRD_BIG_HITBOX_H,
  BIRD_BIG_HITBOX_W,
  BIRD_SMALL_DISPLAY_H,
  BIRD_SMALL_DISPLAY_W,
  BIRD_SMALL_HITBOX_H,
  BIRD_SMALL_HITBOX_W,
  BTN_DOWN,
  BTN_LEFT,
  BTN_RIGHT,
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
  PLANE_DISPLAY_H,
  PLANE_DISPLAY_W,
  PLANE_HITBOX_PARTS,
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
  encodeTranscript,
  fpToFloat,
  stepMut,
  type GameState,
} from "@flight/sim";
import { backgroundFor } from "../backgrounds.js";
import { connect, getAddress, onWalletChange } from "../chain/wallet.js";
import { clearLatestRun, setLatestRun } from "../chain/transcript-buffer.js";
import { INTERMISSION_DURATION_MS, INTERMISSIONS } from "../intermissions.js";
import { INTRO_BODY, INTRO_HEADER, INTRO_HINT, INTRO_TITLE_TEMPLATE } from "../intro.js";
import { OUTROS } from "../outros.js";

interface PillarSprites {
  top: Phaser.GameObjects.Image;
  bottom: Phaser.GameObjects.Image;
}

type Phase = "intro" | "ready" | "playing" | "intermission" | "gameOver";

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
  [EnemyKind.BirdSmall]: { displayW: BIRD_SMALL_DISPLAY_W, displayH: BIRD_SMALL_DISPLAY_H, hitboxW: BIRD_SMALL_HITBOX_W, hitboxH: BIRD_SMALL_HITBOX_H, texture: "bird_small_flap", flipX: true },
  [EnemyKind.BirdBig]:   { displayW: BIRD_BIG_DISPLAY_W,   displayH: BIRD_BIG_DISPLAY_H,   hitboxW: BIRD_BIG_HITBOX_W,   hitboxH: BIRD_BIG_HITBOX_H,   texture: "bird_big_flap",   flipX: true  },
  [EnemyKind.Drone]:     { displayW: DRONE_DISPLAY_W,      displayH: DRONE_DISPLAY_H,      hitboxW: DRONE_HITBOX_W,      hitboxH: DRONE_HITBOX_H,      texture: "drone",      flipX: true  },
  [EnemyKind.Jet]:       { displayW: JET_DISPLAY_W,        displayH: JET_DISPLAY_H,        hitboxW: JET_HITBOX_W,        hitboxH: JET_HITBOX_H,        texture: "jet",        flipX: false },
  [EnemyKind.Ufo]:       { displayW: UFO_DISPLAY_W,        displayH: UFO_DISPLAY_H,        hitboxW: UFO_HITBOX_W,        hitboxH: UFO_HITBOX_H,        texture: "ufo",        flipX: false },
  [EnemyKind.BannerPlane]: { displayW: BANNER_PLANE_DISPLAY_W, displayH: BANNER_PLANE_DISPLAY_H, hitboxW: BANNER_PLANE_HITBOX_W, hitboxH: BANNER_PLANE_HITBOX_H, texture: "propeller_plane", flipX: false },
};

export class PlayScene extends Phaser.Scene {
  private state!: GameState;
  private accumulator = 0;
  private phase: Phase = "ready";
  private best = 0;
  private seed = 0;

  // Run transcript — one byte per simulated tick (the `buttons` value).
  // Phase 3 prep: captured at the source of truth (the stepMut call) so a
  // downloaded .bin round-trips through replay() to the same final state.
  // 36000 bytes = 10 minutes at 60 Hz — well over any realistic run.
  private transcriptBuf = new Uint8Array(36000);
  private transcriptLen = 0;

  private bg!: Phaser.GameObjects.TileSprite;
  private bgFading: Phaser.GameObjects.TileSprite | null = null;
  private flickerOverlay!: Phaser.GameObjects.Rectangle;

  private planeSprite!: Phaser.GameObjects.Image;
  private planeSmokeSprite!: Phaser.GameObjects.Sprite;
  private pillarSprites = new Map<number, PillarSprites>();
  private enemySprites = new Map<number, Phaser.GameObjects.Sprite>();
  private enemyPlumes = new Map<number, Phaser.GameObjects.Sprite>();
  private bannerParts = new Map<number, {
    cord: Phaser.GameObjects.Rectangle;
    banner: Phaser.GameObjects.Rectangle;
    text: Phaser.GameObjects.Text;
  }>();
  private missileSprites = new Map<number, Phaser.GameObjects.Image>();
  private missilePlumes = new Map<number, Phaser.GameObjects.Sprite>();
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
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;

  private speedText!: Phaser.GameObjects.Text;

  private debug = false;
  private debugGfx?: Phaser.GameObjects.Graphics;

  // Intermission overlay (between stages)
  private interBg!: Phaser.GameObjects.Rectangle;
  private interTitle!: Phaser.GameObjects.Text;
  private interBody!: Phaser.GameObjects.Text;
  private interCountdown!: Phaser.GameObjects.Text;
  private interHint!: Phaser.GameObjects.Text;
  private interEndsAt = 0;

  // Typewriter state for the body text in intro / intermission / outro.
  // Reveals one whole *word* at a time — feels like a teletype/radio dispatch
  // rather than a CRT char-by-char animation. Whitespace and newlines
  // surrounding a word ride along with it so line breaks land naturally.
  private bodyFullText = "";
  private bodyCharIndex = 0;
  private bodyTypingDone = true;
  private bodyTypeStartTime = 0;
  // Character-at-a-time reveal; tune for feel. ~28 ms ≈ 36 chars/sec —
  // smooth at 60 fps (one char every ~1.7 frames), comfortable to read.
  private readonly bodyTypeMsPerChar = 28;

  // Universal "SKIP" button shown while an overlay is up
  private skipBtnBg!: Phaser.GameObjects.Rectangle;
  private skipBtnText!: Phaser.GameObjects.Text;

  // Sentinel Protocol outro — branded delay notification + CTA.
  private spHeader!: Phaser.GameObjects.Text;
  private spDivider!: Phaser.GameObjects.Rectangle;
  private spTagline!: Phaser.GameObjects.Text;
  private spSubTagline!: Phaser.GameObjects.Text;

  // Inline auth row shown inside the intro body — clickable [SIGN IN]
  // button when disconnected, "✓ <addr>" status line when connected.
  // Replaces the bottom-of-page DOM signin tip; lives in the same
  // Phaser layer as the rest of the briefing so it reads as part of
  // the page, not a banner pasted on top.
  private interAuthRow!: Phaser.GameObjects.Text;
  private walletUnsubscribe?: () => void;

  constructor() { super("PlayScene"); }

  create(): void {
    // Bird wing-flap animations — defined once at scene startup. Phaser anims
    // are global, so guard so scene.restart() doesn't re-register.
    if (!this.anims.exists("bird_small_flap")) {
      this.anims.create({
        key: "bird_small_flap",
        frames: this.anims.generateFrameNumbers("bird_small_flap", { start: 0, end: 6 }),
        frameRate: 12,
        repeat: -1,
      });
    }
    if (!this.anims.exists("bird_big_flap")) {
      this.anims.create({
        key: "bird_big_flap",
        frames: this.anims.generateFrameNumbers("bird_big_flap", { start: 0, end: 6 }),
        frameRate: 9,
        repeat: -1,
      });
    }
    if (!this.anims.exists("plume_flicker")) {
      this.anims.create({
        key: "plume_flicker",
        frames: this.anims.generateFrameNumbers("plume_flicker", { start: 0, end: 6 }),
        frameRate: 14,
        repeat: -1,
      });
    }
    if (!this.anims.exists("smoke_drift")) {
      this.anims.create({
        key: "smoke_drift",
        frames: this.anims.generateFrameNumbers("smoke_drift", { start: 0, end: 6 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!this.anims.exists("propeller_spin")) {
      this.anims.create({
        key: "propeller_spin",
        frames: this.anims.generateFrameNumbers("propeller_plane", { start: 0, end: 6 }),
        frameRate: 24,
        repeat: -1,
      });
    }

    this.seed = this.makeSeed();
    this.state = createInitialState(this.seed, startStageFromUrl());
    this.accumulator = 0;
    // Reset transcript capture for the new run. Phaser reuses the scene
    // instance across scene.restart(), so the class-field initializer only
    // ran the first time — without this, runs concatenate across restarts.
    this.transcriptLen = 0;
    // A fresh play is the player's explicit "I don't want to submit the
    // previous run" — drop the captured run so the floating Submit button
    // disappears as soon as they start over. Pending proofs in localStorage
    // (intentional commitments from earlier sessions) are NOT cleared
    // here — they survive across restarts until signed or discarded.
    clearLatestRun();
    // Skip the intro for stage jumps via ?stage=N and for test runs — the
    // briefing is only shown for fresh Stage-Common starts a real player sees.
    this.phase =
      this.state.stage === Stage.Common && !testEnabled() ? "intro" : "ready";
    this.best = this.loadBest();

    this.bg = this.add
      .tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, backgroundFor(this.state.stage as Stage, this.seed))
      .setOrigin(0, 0)
      .setDepth(0);

    this.flickerOverlay = this.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0xffffff, 0)
      .setOrigin(0, 0)
      .setDepth(15);

    // Plane smoke trail — soft gray exhaust sitting behind the plane (depth 3
    // so the plane silhouette covers the dense attachment end). Plane faces
    // RIGHT so the trail attaches on the LEFT/tail side; source already has
    // the dense puff on the right which lines up without flipping.
    this.planeSmokeSprite = this.add
      .sprite(PLANE_X - PLANE_DISPLAY_W / 2, fpToFloat(this.state.plane.y), "smoke_drift")
      .setDepth(3)
      .setAlpha(0);
    this.planeSmokeSprite.setDisplaySize(100, 100);
    this.planeSmokeSprite.play("smoke_drift");

    // Plane below enemies/missiles so a colliding entity is visible at the
    // moment of game-over instead of being hidden behind the 256×128 plane art.
    this.planeSprite = this.add.image(PLANE_X, fpToFloat(this.state.plane.y), "plane").setDepth(4);
    this.planeSprite.setDisplaySize(PLANE_DISPLAY_W, PLANE_DISPLAY_H);

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
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 36, "↑ / ↓ to steer", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "20px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 1).setDepth(10);

    const kb = this.input.keyboard!;
    this.keyUp = kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown = kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keyLeft = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    kb.on("keydown-UP", () => this.onSteerPressed());
    kb.on("keydown-DOWN", () => this.onSteerPressed());
    kb.on("keydown-LEFT", () => this.onSteerPressed());
    kb.on("keydown-RIGHT", () => this.onSteerPressed());
    kb.on("keydown-W", () => this.onSteerPressed());
    kb.on("keydown-S", () => this.onSteerPressed());
    kb.on("keydown-A", () => this.onSteerPressed());
    kb.on("keydown-D", () => this.onSteerPressed());
    kb.on("keydown-SPACE", () => {
      if (this.phase === "intro" || this.phase === "intermission" || this.phase === "gameOver") {
        this.onSkip();
      } else {
        this.onSteerPressed();
      }
    });
    kb.on("keydown-R", () => this.maybeRestart());
    kb.on("keydown-T", () => this.downloadTranscript());
    // Any other key in intro fast-forwards / dismisses the briefing too.
    kb.on("keydown", () => {
      if (this.phase === "intro") this.onSkip();
    });

    // Small speed indicator near the fuel bar — shows ◀ / ▶ when held.
    this.speedText = this.add
      .text(WORLD_WIDTH - 24, 100, "", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "20px", color: "#ffd54f", stroke: "#000000", strokeThickness: 4 })
      .setOrigin(1, 0)
      .setDepth(10);

    this.debug = debugEnabled();
    if (this.debug) {
      this.debugGfx = this.add.graphics().setDepth(20);
    }

    // Intermission overlay — dark screen + briefing text shown between stages.
    // Sits above the flicker overlay (depth 15) and below the debug graphics
    // (depth 20) so debug rectangles remain inspectable even during a wait.
    this.interBg = this.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x000000, 0.85)
      .setOrigin(0, 0)
      .setDepth(16)
      .setVisible(false);
    this.interTitle = this.add
      .text(WORLD_WIDTH / 2, 110, "", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "44px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(17)
      .setVisible(false);
    // Body is horizontally centered. Origin (0.5, 0) anchors the textbox at
    // its top-center so multi-line content stays balanced against the title
    // and CTA. Note: typewriter reveal will shift the line slightly as words
    // arrive (the box re-centers each tick) — acceptable trade for layout.
    this.interBody = this.add
      .text(WORLD_WIDTH / 2, 180, "", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "22px",
        color: "#e0e0e0",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setLineSpacing(10)
      .setDepth(17)
      .setVisible(false);
    this.interCountdown = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 90, "", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "20px",
        color: "#9be7ff",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(17)
      .setVisible(false);
    this.interHint = this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT - 50, "SPACE to continue", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "16px",
        color: "#bbbbbb",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(17)
      .setVisible(false);

    // Sentinel Protocol header (game-over only)
    this.spHeader = this.add
      .text(WORLD_WIDTH / 2, 50, "SENTINEL PROTOCOL  //  DELAY NOTIFICATION", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "16px",
        color: "#5ec8ff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(17)
      .setVisible(false);
    this.spDivider = this.add
      .rectangle(WORLD_WIDTH / 2, 72, 520, 1, 0x5ec8ff, 0.5)
      .setDepth(17)
      .setVisible(false);

    // Main tagline — deadpan corporate-disaster vibe.
    this.spTagline = this.add
      .text(WORLD_WIDTH / 2, 430, "DELAY WOULD HAVE BEEN COVERED", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "32px",
        color: "#ffd54f",
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(18)
      .setVisible(false);

    // Sub-tagline — the joke landing.
    this.spSubTagline = this.add
      .text(WORLD_WIDTH / 2, 480, "if you'd hedged your bets with Sentinel.  maybe next time.", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "18px",
        color: "#e0e0e0",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(18)
      .setVisible(false);

    // (Old Phaser-canvas "COVER YOUR NEXT FLIGHT" CTA removed — there's
    // now a single DOM floating button at the bottom-center that handles
    // both the submit-on-PB and Sentinel-on-non-PB cases. One CTA per
    // game-over screen, end of story.)

    // Inline auth row inside the intro body. Two states:
    //   not signed in → "[ SIGN IN — click to start counting your scores ]"
    //                    clickable, accent-yellow, opens the wallet picker
    //   signed in     → "✓ G… — submit on-chain after the run to count"
    //                    informational, soft green, non-interactive
    this.interAuthRow = this.add
      .text(WORLD_WIDTH / 2, 480, "", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "18px",
        color: "#ffd54f",
        stroke: "#000000",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5, 0.5)
      .setDepth(18)
      .setVisible(false);
    this.interAuthRow.setInteractive({ useHandCursor: true });
    this.interAuthRow.on("pointerdown", () => {
      if (!getAddress()) {
        connect().catch(() => { /* user cancelled — fine */ });
      }
    });
    // Subscribe to wallet state changes so the row updates live the moment
    // the kit modal closes. Unsubscribe on scene shutdown / restart so we
    // don't accumulate stale listeners.
    this.walletUnsubscribe?.();
    this.walletUnsubscribe = onWalletChange((addr) => this.updateAuthRow(addr));
    this.events.once("shutdown", () => {
      this.walletUnsubscribe?.();
      this.walletUnsubscribe = undefined;
    });

    // Universal SKIP button — bottom-right corner of the overlay
    this.skipBtnBg = this.add
      .rectangle(WORLD_WIDTH - 70, WORLD_HEIGHT - 30, 110, 30, 0x000000, 0.55)
      .setDepth(17)
      .setStrokeStyle(1, 0xffffff, 0.6)
      .setVisible(false);
    this.skipBtnText = this.add
      .text(WORLD_WIDTH - 70, WORLD_HEIGHT - 30, "SKIP  →", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "14px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(18)
      .setVisible(false);
    this.skipBtnBg
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => this.skipBtnBg.setFillStyle(0x333333, 0.8))
      .on("pointerout", () => this.skipBtnBg.setFillStyle(0x000000, 0.55))
      .on("pointerdown", () => this.onSkip());

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
          fuel: fpToFloat(this.state.fuel),
          plane: { y: fpToFloat(this.state.plane.y), vy: fpToFloat(this.state.plane.vy) },
          pillars: this.state.pillars.map((p) => ({ id: p.id, x: fpToFloat(p.x), gapY: fpToFloat(p.gapY), passed: p.passed })),
          enemies: this.state.enemies.map((e) => ({ id: e.id, kind: e.kind, x: fpToFloat(e.x), y: fpToFloat(e.y), vx: fpToFloat(e.vx), passed: e.passed })),
          missiles: this.state.missiles.map((m) => ({ id: m.id, tier: m.tier, frame: m.frame, x: fpToFloat(m.x), y: fpToFloat(m.y), vx: fpToFloat(m.vx) })),
          fuelTokens: this.state.fuelTokens.map((t) => ({ id: t.id, x: fpToFloat(t.x), y: fpToFloat(t.y) })),
          best: this.best,
        }),
        constants: () => ({
          PLANE_X,
          // Outer AABB — for legacy collision-classifier tests.
          PLANE_HITBOX_W: 240, PLANE_HITBOX_H: 102, PLANE_HITBOX_OFFSET_Y: -4,
          // Exposed multi-rect parts for tests that want to match the sim.
          PLANE_HITBOX_PARTS: PLANE_HITBOX_PARTS as unknown as number,
          PILLAR_WIDTH, PILLAR_HITBOX_W, PILLAR_SRC_H, PILLAR_TOP_GAP_PAD_SRC, PILLAR_BOT_GAP_PAD_SRC, PILLAR_GAP,
          BIRD_SMALL_HITBOX_W, BIRD_SMALL_HITBOX_H, BIRD_BIG_HITBOX_W, BIRD_BIG_HITBOX_H,
          DRONE_HITBOX_W, DRONE_HITBOX_H, JET_HITBOX_W, JET_HITBOX_H, UFO_HITBOX_W, UFO_HITBOX_H,
          MISSILE_HITBOX_W, MISSILE_HITBOX_H,
          FUEL_TOKEN_HITBOX, FUEL_MAX,
          WORLD_WIDTH, WORLD_HEIGHT,
        }),
      };
    }

    if (this.phase === "intro") this.showIntro();
  }

  override update(_time: number, delta: number): void {
    if (this.phase === "playing") {
      this.accumulator += delta;
      let safety = 6;
      while (this.accumulator >= TICK_MS && safety-- > 0) {
        this.accumulator -= TICK_MS;
        const btn = this.readButtons();
        if (this.transcriptLen < this.transcriptBuf.length) {
          this.transcriptBuf[this.transcriptLen++] = btn & 0xff;
        }
        stepMut(this.state, { buttons: btn });
        if (this.state.stageJustChanged) {
          this.onStageChanged();
          if (this.maybeEnterIntermission()) break;
        }
        if (this.state.gameOver) {
          this.phase = "gameOver";
          this.commitBest();
          this.publishTranscriptBuffer();
          this.showOutro();
          break;
        }
      }
    } else if (this.phase === "intermission") {
      this.updateIntermission();
    }
    // Typewriter ticks on every frame while an overlay is up
    if (!this.bodyTypingDone && (this.phase === "intro" || this.phase === "intermission" || this.phase === "gameOver")) {
      this.tickTyping();
    }
    this.render(delta);
  }

  private startTyping(fullText: string): void {
    this.bodyFullText = fullText;
    this.bodyCharIndex = 0;
    this.bodyTypingDone = fullText.length === 0;
    this.bodyTypeStartTime = this.time.now;
    this.refreshBodyText();
  }

  private tickTyping(): void {
    const elapsed = this.time.now - this.bodyTypeStartTime;
    const target = Math.min(
      this.bodyFullText.length,
      Math.floor(elapsed / this.bodyTypeMsPerChar),
    );
    if (target > this.bodyCharIndex) {
      this.bodyCharIndex = target;
      if (this.bodyCharIndex >= this.bodyFullText.length) {
        this.bodyTypingDone = true;
      }
    }
    // Refresh every frame so the cursor can blink even when no new char
    // landed this tick.
    this.refreshBodyText();
  }

  private refreshBodyText(): void {
    if (this.bodyTypingDone) {
      this.interBody.setText(this.bodyFullText);
      return;
    }
    const visible = this.bodyFullText.substring(0, this.bodyCharIndex);
    // Blinking caret. Use a half-width-ish block character so it reads as a
    // teletype cursor in monospace. Swap to a space (not empty) so the line
    // doesn't reflow as the cursor toggles off.
    const showCursor = Math.floor(this.time.now / 500) % 2 === 0;
    this.interBody.setText(visible + (showCursor ? "▌" : " "));
  }

  private completeTyping(): void {
    this.bodyCharIndex = this.bodyFullText.length;
    this.bodyTypingDone = true;
    this.refreshBodyText();
  }

  // Universal skip — finishes typing if it's running, otherwise advances to
  // the next phase based on which overlay is up.
  private onSkip(): void {
    if (!this.bodyTypingDone) {
      this.completeTyping();
      return;
    }
    if (this.phase === "intro") this.exitIntro();
    else if (this.phase === "intermission") this.exitIntermission();
    else if (this.phase === "gameOver") this.maybeRestart();
  }

  // Returns true if the sim tick loop should pause (intermission active).
  private maybeEnterIntermission(): boolean {
    const copy = INTERMISSIONS[this.state.stage as Stage];
    if (!copy) return false;
    this.phase = "intermission";
    this.interEndsAt = this.time.now + INTERMISSION_DURATION_MS;
    // Use the intermission-default positions (briefing layout — different
    // from outro which repositions title/body lower).
    this.interTitle.setY(WORLD_HEIGHT / 2 - 120).setText(copy.title).setVisible(true);
    this.interBody.setY(WORLD_HEIGHT / 2 - 70).setVisible(true);
    this.interCountdown.setY(WORLD_HEIGHT - 110).setVisible(true);
    this.interHint.setY(WORLD_HEIGHT - 70).setText("SPACE to continue").setVisible(true);
    this.interBg.setVisible(true);
    this.skipBtnBg.setVisible(true);
    this.skipBtnText.setVisible(true);
    this.hintText.setVisible(false);
    this.startTyping(copy.body.join("\n"));
    // Drop input that may have been queued so we don't immediately skip if
    // SPACE was held during the transition.
    this.accumulator = 0;
    return true;
  }

  private updateIntermission(): void {
    const remainingMs = Math.max(0, this.interEndsAt - this.time.now);
    const remainingSec = Math.ceil(remainingMs / 1000);
    this.interCountdown.setText(`RESUMING IN ${remainingSec}…`);
    if (remainingMs <= 0) {
      this.exitIntermission();
    }
  }

  private exitIntermission(): void {
    this.interBg.setVisible(false);
    this.interTitle.setVisible(false);
    this.interBody.setVisible(false);
    this.interCountdown.setVisible(false);
    this.interHint.setVisible(false);
    this.skipBtnBg.setVisible(false);
    this.skipBtnText.setVisible(false);
    this.hintText.setVisible(true);
    this.bodyTypingDone = true;
    this.phase = "playing";
    this.accumulator = 0;
  }

  // Pre-flight briefing — first thing the player sees on a fresh run.
  // Reuses the intermission widgets; any key dismisses to "ready".
  private showIntro(): void {
    const flightId = "FS-" + Math.abs(this.seed % 100000).toString().padStart(5, "0");
    this.interBg.setVisible(true);
    this.spHeader.setText(INTRO_HEADER).setVisible(true);
    this.spDivider.setVisible(true);
    this.interTitle.setY(130).setText(INTRO_TITLE_TEMPLATE(flightId)).setVisible(true);
    this.interBody.setY(200).setVisible(true);
    this.interHint.setY(WORLD_HEIGHT - 50).setText(INTRO_HINT).setVisible(true);
    this.interCountdown.setVisible(false);
    this.spTagline.setVisible(false);
    this.spSubTagline.setVisible(false);
    this.skipBtnBg.setVisible(true);
    this.skipBtnText.setVisible(true);
    // Hide the game-world hint (`↑ / ↓ to steer`) — it sits at depth 10
    // and bleeds through the 0.85-alpha overlay, looking like overflow.
    this.hintText.setVisible(false);
    this.startTyping(INTRO_BODY.join("\n"));
    // Inline auth row appears below the typed body, snapping to whichever
    // sign-in state the player is in right now.
    this.interAuthRow.setY(500).setVisible(true);
    this.updateAuthRow(getAddress());
  }

  /// Refresh the inline auth row's text + color based on wallet state.
  /// Always called from showIntro (initial render) and from the
  /// onWalletChange subscription (live updates while the intro is up).
  private updateAuthRow(addr: string | null): void {
    if (addr) {
      const short = addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
      this.interAuthRow
        .setText(`✓ signed in: ${short}  ·  remember to submit your best after the run`)
        .setColor("#7aff8e");
    } else {
      this.interAuthRow
        .setText("▶  CLICK TO SIGN IN  ·  unsubmitted scores don't count")
        .setColor("#ffd54f");
    }
  }

  private exitIntro(): void {
    this.interBg.setVisible(false);
    this.spHeader.setVisible(false);
    this.spDivider.setVisible(false);
    this.interTitle.setVisible(false);
    this.interBody.setVisible(false);
    this.interHint.setVisible(false);
    this.interAuthRow.setVisible(false);
    this.skipBtnBg.setVisible(false);
    this.skipBtnText.setVisible(false);
    this.hintText.setVisible(true);
    this.bodyTypingDone = true;
    this.phase = "ready";
  }

  // Shows the game-over outro as a Sentinel Protocol delay slip. Reuses the
  // intermission dark-screen widgets plus the slip + CTA created in create().
  private showOutro(): void {
    const copy = OUTROS[this.state.gameOverReason] ?? OUTROS[0];
    const isBest = this.state.score > 0 && this.state.score >= this.best;

    // Outro layout (top → bottom, canvas y, WORLD_HEIGHT = 720):
    //   ~50  spHeader      SENTINEL PROTOCOL // DELAY NOTIFICATION
    //   ~72  spDivider
    //   ~120 interTitle    FLIGHT DIVERTED
    //   ~180 interBody     diversion reason copy (typewriter)
    //   ~430 spTagline     DELAY WOULD HAVE BEEN COVERED
    //   ~480 spSubTagline  "if you'd hedged your bets..."
    //   ~530 interCountdown  SCORE x  BEST y  (moved up — was 670)
    //   ~565 interHint       R restart        (moved up — was 700)
    //   ~580–680 DOM submit button + caption sit here (bottom-anchored)
    //   ~690 SKIP button (bottom-right corner)
    // Keeping the canvas score/restart text ABOVE the DOM button area
    // avoids the visual collision where bottom:110px DOM button used to
    // overlap canvas y≈600–650 on 16:9 viewports.
    this.interTitle.setY(120);
    this.interBody.setY(180);

    this.interBg.setVisible(true);
    this.interTitle.setText(copy.title).setVisible(true);
    this.interBody.setVisible(true);
    this.interCountdown
      .setY(530)
      .setText(isBest ? `NEW BEST  ${this.state.score}` : `SCORE ${this.state.score}    BEST ${this.best}`)
      .setColor(isBest ? "#ffd54f" : "#9be7ff")
      .setVisible(true);
    // T (download .bin transcript) is still bound as a dev shortcut but
    // intentionally not advertised — the relay handles proving end-to-end
    // now, players don't need to capture raw bin files.
    this.interHint.setY(565).setText("R to restart").setVisible(true);

    // Sentinel Protocol branded outro — header, big tagline, sub-tagline.
    // The single floating DOM button (apps/web/src/ui/submit-ui.ts) is the
    // CTA — handles both submit-on-PB and Sentinel-on-non-PB; no Phaser-
    // canvas CTA fights for the player's eye.
    this.spHeader.setText("SENTINEL PROTOCOL  //  DELAY NOTIFICATION").setVisible(true);
    this.spDivider.setVisible(true);
    this.spTagline.setVisible(true);
    this.spSubTagline.setVisible(true);

    // SKIP button — in outro it functions as "restart now"
    this.skipBtnBg.setVisible(true);
    this.skipBtnText.setVisible(true);
    // Hide the in-world hint so it doesn't bleed through under the dark overlay.
    this.hintText.setVisible(false);
    this.startTyping(copy.body.join("\n"));
  }

  private hideOutro(): void {
    this.interBg.setVisible(false);
    this.interTitle.setVisible(false);
    this.interBody.setVisible(false);
    this.interCountdown.setVisible(false);
    this.interCountdown.setColor("#9be7ff");
    this.interHint.setVisible(false);
    this.spHeader.setVisible(false);
    this.spDivider.setVisible(false);
    this.spTagline.setVisible(false);
    this.spSubTagline.setVisible(false);
    this.skipBtnBg.setVisible(false);
    this.skipBtnText.setVisible(false);
    this.hintText.setVisible(true);
    this.bodyTypingDone = true;
  }

  private readButtons(): number {
    let b = 0;
    if (this.keyUp.isDown || this.keyW.isDown) b |= BTN_UP;
    if (this.keyDown.isDown || this.keyS.isDown) b |= BTN_DOWN;
    if (this.keyLeft.isDown || this.keyA.isDown) b |= BTN_LEFT;
    if (this.keyRight.isDown || this.keyD.isDown) b |= BTN_RIGHT;
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
    // Backgrounds scroll using the seamless mirror-composed textures built in
    // BootScene; scroll speed follows the player's throttle so ← / → feels
    // like the world is dragging by.
    const planeYpx = fpToFloat(this.state.plane.y);
    const planeVypx = fpToFloat(this.state.plane.vy);
    if (this.phase === "ready") {
      this.bg.tilePositionX += delta * 0.04;
      this.planeSprite.y = planeYpx + Math.sin(this.time.now / 220) * 6;
      this.planeSprite.setRotation(0);
    } else {
      // worldDistance is Q24.8 now; convert back to float for the parallax px math.
      const scroll = fpToFloat(this.state.worldDistance) * 1.5;
      this.bg.tilePositionX = scroll;
      if (this.bgFading) this.bgFading.tilePositionX = scroll;
      this.planeSprite.y = planeYpx;
      this.planeSprite.setRotation(Phaser.Math.Clamp(planeVypx / 12, -0.45, 0.45));
    }

    // Plane smoke trail — anchored to plane tail (left side, plane faces
    // right) and rotated with the plane; alpha eases on while → is held
    // (worldSpeedMul > 1) and off otherwise.
    {
      const angle = this.planeSprite.rotation;
      const tailOffX = -130;
      this.planeSmokeSprite.x = this.planeSprite.x + tailOffX * Math.cos(angle);
      this.planeSmokeSprite.y = this.planeSprite.y + tailOffX * Math.sin(angle);
      this.planeSmokeSprite.setRotation(angle);
      const boosting = this.phase === "playing" && fpToFloat(this.state.worldSpeedMul) > 1.01;
      const targetAlpha = boosting ? 1 : 0;
      this.planeSmokeSprite.alpha = Phaser.Math.Linear(this.planeSmokeSprite.alpha, targetAlpha, 0.18);
    }

    // ---- Pillars ----
    const seenPillars = new Set<number>();
    for (const p of this.state.pillars) {
      seenPillars.add(p.id);
      const px = fpToFloat(p.x);
      const pGapY = fpToFloat(p.gapY);
      let sprites = this.pillarSprites.get(p.id);
      if (!sprites) {
        const top = this.add.image(px + PILLAR_WIDTH / 2, pGapY - PILLAR_GAP / 2, "top_pillar").setOrigin(0.5, 1).setDepth(3);
        top.setDisplaySize(PILLAR_WIDTH, pGapY - PILLAR_GAP / 2);
        const bottom = this.add.image(px + PILLAR_WIDTH / 2, pGapY + PILLAR_GAP / 2, "bottom_pillar").setOrigin(0.5, 0).setDepth(3);
        bottom.setDisplaySize(PILLAR_WIDTH, WORLD_HEIGHT - (pGapY + PILLAR_GAP / 2));
        sprites = { top, bottom };
        this.pillarSprites.set(p.id, sprites);
      }
      sprites.top.x = px + PILLAR_WIDTH / 2;
      sprites.bottom.x = px + PILLAR_WIDTH / 2;
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
      const ex = fpToFloat(e.x);
      const ey = fpToFloat(e.y);
      const spec = ENEMY_SPEC[e.kind as EnemyKind];
      let sprite = this.enemySprites.get(e.id);
      if (!sprite) {
        sprite = this.add.sprite(ex, ey, spec.texture).setDepth(5);
        // Bird spritesheets are square (64x64 / 96x96) with the bird centered
        // and proportional whitespace — stretching to the rectangular display
        // dims would pancake them, so use displayW for both axes. Hitboxes are
        // independent and stay tight to the actual silhouette.
        const isBird = e.kind === EnemyKind.BirdSmall || e.kind === EnemyKind.BirdBig;
        if (isBird) sprite.setDisplaySize(spec.displayW, spec.displayW);
        else sprite.setDisplaySize(spec.displayW, spec.displayH);
        sprite.setFlipX(spec.flipX);
        if (e.kind === EnemyKind.BirdSmall) sprite.play("bird_small_flap");
        else if (e.kind === EnemyKind.BirdBig) sprite.play("bird_big_flap");
        else if (e.kind === EnemyKind.BannerPlane) sprite.play("propeller_spin");
        this.enemySprites.set(e.id, sprite);
      }
      sprite.x = ex; sprite.y = ey;

      // Banner-tow trail — SENTINEL.XYZ banner pulled behind the propeller
      // plane via a short cord. Plane faces left (moving left), so the banner
      // trails to the right with a slight downward droop.
      if (e.kind === EnemyKind.BannerPlane) {
        let parts = this.bannerParts.get(e.id);
        if (!parts) {
          const cord = this.add.rectangle(0, 0, 28, 2, 0x333333).setDepth(4);
          const banner = this.add
            .rectangle(0, 0, 150, 30, 0xc62828)
            .setDepth(4)
            .setStrokeStyle(2, 0xffd54f);
          const text = this.add
            .text(0, 0, "SENTINEL.XYZ", {
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: "18px",
              color: "#ffffff",
              stroke: "#000000",
              strokeThickness: 3,
              fontStyle: "bold",
            })
            .setOrigin(0.5, 0.5)
            .setDepth(5);
          parts = { cord, banner, text };
          this.bannerParts.set(e.id, parts);
        }
        const tailX = ex + spec.displayW / 2 - 8; // 8 px inside fuselage so the cord origin reads as attached
        const droopY = ey + 14;
        parts.cord.x = tailX + 14;
        parts.cord.y = (ey + droopY) / 2;
        parts.banner.x = tailX + 28 + 75; // cord length + half banner width
        parts.banner.y = droopY;
        parts.text.x = parts.banner.x;
        parts.text.y = parts.banner.y;
      }

      // Jet exhaust plume — hot core flipped to the left so it attaches to
      // the jet's right/rear edge (jets face left, moving left).
      if (e.kind === EnemyKind.Jet) {
        let plume = this.enemyPlumes.get(e.id);
        if (!plume) {
          plume = this.add.sprite(ex, ey, "plume_flicker").setDepth(4).setFlipX(true);
          plume.setDisplaySize(70, 70);
          plume.play("plume_flicker");
          this.enemyPlumes.set(e.id, plume);
        }
        plume.x = ex + spec.displayW / 2 - 8;
        plume.y = ey;
      }
    }
    for (const [id, sprite] of this.enemySprites) {
      if (!seenEnemies.has(id)) {
        sprite.destroy();
        this.enemySprites.delete(id);
        const plume = this.enemyPlumes.get(id);
        if (plume) { plume.destroy(); this.enemyPlumes.delete(id); }
        const parts = this.bannerParts.get(id);
        if (parts) {
          parts.cord.destroy();
          parts.banner.destroy();
          parts.text.destroy();
          this.bannerParts.delete(id);
        }
      }
    }

    // ---- Missiles ----
    const seenMissiles = new Set<number>();
    for (const m of this.state.missiles) {
      seenMissiles.add(m.id);
      const mx = fpToFloat(m.x);
      const my = fpToFloat(m.y);
      let sprite = this.missileSprites.get(m.id);
      if (!sprite) {
        sprite = this.add.image(mx, my, "missiles", m.frame).setDepth(5);
        sprite.setDisplaySize(MISSILE_DISPLAY_W, MISSILE_DISPLAY_H);
        // Source missiles in the spritesheet already face LEFT (nose left,
        // exhaust right), which matches their leftward motion. assets.json
        // incorrectly says "facing: right" — don't flip.
        this.missileSprites.set(m.id, sprite);
      }
      sprite.x = mx; sprite.y = my;

      // Missile exhaust plume — same orientation as jets.
      let plume = this.missilePlumes.get(m.id);
      if (!plume) {
        plume = this.add.sprite(mx, my, "plume_flicker").setDepth(4).setFlipX(true);
        plume.setDisplaySize(34, 34);
        plume.play("plume_flicker");
        this.missilePlumes.set(m.id, plume);
      }
      plume.x = mx + MISSILE_DISPLAY_W / 2 - 4;
      plume.y = my;
    }
    for (const [id, sprite] of this.missileSprites) {
      if (!seenMissiles.has(id)) {
        sprite.destroy();
        this.missileSprites.delete(id);
        const plume = this.missilePlumes.get(id);
        if (plume) { plume.destroy(); this.missilePlumes.delete(id); }
      }
    }

    // ---- Fuel tokens ----
    const seenTokens = new Set<number>();
    for (const t of this.state.fuelTokens) {
      seenTokens.add(t.id);
      const tx = fpToFloat(t.x);
      const ty = fpToFloat(t.y);
      let sprite = this.fuelTokenSprites.get(t.id);
      if (!sprite) {
        sprite = this.add.image(tx, ty, "fuel_token").setDepth(4);
        sprite.setDisplaySize(FUEL_TOKEN_DISPLAY, FUEL_TOKEN_DISPLAY);
        // Light-blue glow so the gold coin pops against the orange/red sunset
        // and dusk backgrounds where the token's own colour blends in.
        sprite.preFX?.addGlow(0x80c8ff, 6, 0, false, 0.6, 8);
        this.fuelTokenSprites.set(t.id, sprite);
      }
      sprite.x = tx; sprite.y = ty;
      // Spin animation — flip across the vertical axis. scaleX must remain
      // proportional to the base display size; the source PNG is 1254×1254
      // so the resting scale is FUEL_TOKEN_DISPLAY / 1254, not 1.
      const phase = this.time.now / 280;
      const baseScale = FUEL_TOKEN_DISPLAY / (sprite.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement).width;
      sprite.scaleX = baseScale * Math.cos(phase);
      sprite.scaleY = baseScale;
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
      const ratio = Math.max(0, Math.min(1, fpToFloat(this.state.fuel) / FUEL_MAX));
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

    // Speed indicator
    if (this.phase === "playing") {
      const m = fpToFloat(this.state.worldSpeedMul);
      if (m > 1.01) this.speedText.setText(`▶▶  ${m.toFixed(1)}×`);
      else if (m < 0.99) this.speedText.setText(`◀  ${m.toFixed(1)}×`);
      else this.speedText.setText("");
    } else {
      this.speedText.setText("");
    }

    if (this.phase === "ready") {
      this.statusText.setText("PRESS ↑ / ↓\nTO FLY");
      this.statusText.setColor("#ffffff");
      this.hintText.setText("↑ ↓ steer    ← → throttle");
    } else if (this.phase === "gameOver") {
      // Outro overlay handles the message; suppress the in-world text.
      this.statusText.setText("");
      this.hintText.setText("");
    } else {
      this.statusText.setText("");
      this.hintText.setText("↑ ↓ steer    ← → throttle");
    }
  }

  private drawDebug(): void {
    const g = this.debugGfx!;
    g.clear();

    const alive = !this.state.gameOver;
    g.lineStyle(2, alive ? 0x00ff00 : 0xff0000, 1);
    const planeY = fpToFloat(this.state.plane.y);
    for (const r of PLANE_HITBOX_PARTS) {
      const cx = PLANE_X + r.offsetX;
      const cy = planeY + r.offsetY;
      g.strokeRect(cx - r.w / 2, cy - r.h / 2, r.w, r.h);
    }

    const pInsetX = (PILLAR_WIDTH - PILLAR_HITBOX_W) / 2;
    for (const p of this.state.pillars) {
      const px = fpToFloat(p.x);
      const pGapY = fpToFloat(p.gapY);
      const visGapTop = pGapY - PILLAR_GAP / 2;
      const visGapBottom = pGapY + PILLAR_GAP / 2;
      const topPillarH = visGapTop;
      const botPillarH = WORLD_HEIGHT - visGapBottom;
      const topInset = (topPillarH * PILLAR_TOP_GAP_PAD_SRC) / PILLAR_SRC_H;
      const botInset = (botPillarH * PILLAR_BOT_GAP_PAD_SRC) / PILLAR_SRC_H;
      const hitGapTop = visGapTop - topInset;
      const hitGapBottom = visGapBottom + botInset;
      g.lineStyle(1, 0xffffff, 0.25);
      g.strokeRect(px, 0, PILLAR_WIDTH, visGapTop);
      g.strokeRect(px, visGapBottom, PILLAR_WIDTH, WORLD_HEIGHT - visGapBottom);
      g.lineStyle(2, 0xffd400, 1);
      g.strokeRect(px + pInsetX, 0, PILLAR_HITBOX_W, hitGapTop);
      g.strokeRect(px + pInsetX, hitGapBottom, PILLAR_HITBOX_W, WORLD_HEIGHT - hitGapBottom);
      g.lineStyle(1, 0x00e5ff, 0.7);
      g.strokeRect(px + pInsetX, hitGapTop, PILLAR_HITBOX_W, hitGapBottom - hitGapTop);
    }

    g.lineStyle(2, 0xff4dff, 1);
    for (const e of this.state.enemies) {
      const ex = fpToFloat(e.x);
      const ey = fpToFloat(e.y);
      const spec = ENEMY_SPEC[e.kind as EnemyKind];
      g.strokeRect(ex - spec.hitboxW / 2, ey - spec.hitboxH / 2, spec.hitboxW, spec.hitboxH);
      g.lineStyle(1, 0xffffff, 0.2);
      g.strokeRect(ex - spec.displayW / 2, ey - spec.displayH / 2, spec.displayW, spec.displayH);
      g.lineStyle(2, 0xff4dff, 1);
    }

    g.lineStyle(2, 0xff8800, 1);
    for (const m of this.state.missiles) {
      const mx = fpToFloat(m.x);
      const my = fpToFloat(m.y);
      g.strokeRect(mx - MISSILE_HITBOX_W / 2, my - MISSILE_HITBOX_H / 2, MISSILE_HITBOX_W, MISSILE_HITBOX_H);
    }

    g.lineStyle(2, 0x00ff88, 1);
    for (const t of this.state.fuelTokens) {
      const tx = fpToFloat(t.x);
      const ty = fpToFloat(t.y);
      g.strokeRect(tx - FUEL_TOKEN_HITBOX / 2, ty - FUEL_TOKEN_HITBOX / 2, FUEL_TOKEN_HITBOX, FUEL_TOKEN_HITBOX);
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
    this.hideOutro();
    for (const sprites of this.pillarSprites.values()) { sprites.top.destroy(); sprites.bottom.destroy(); }
    this.pillarSprites.clear();
    for (const s of this.enemySprites.values()) s.destroy(); this.enemySprites.clear();
    for (const s of this.enemyPlumes.values()) s.destroy(); this.enemyPlumes.clear();
    for (const p of this.bannerParts.values()) { p.cord.destroy(); p.banner.destroy(); p.text.destroy(); }
    this.bannerParts.clear();
    for (const s of this.missileSprites.values()) s.destroy(); this.missileSprites.clear();
    for (const s of this.missilePlumes.values()) s.destroy(); this.missilePlumes.clear();
    for (const s of this.fuelTokenSprites.values()) s.destroy(); this.fuelTokenSprites.clear();
    if (this.bgFading) { this.bgFading.destroy(); this.bgFading = null; }
    this.scene.restart();
  }

  // Save the captured run as a flight_scroll .bin transcript. Format matches
  // encodeTranscript(seed, buttons) in packages/sim — drop the file into the
  // smoke harness or a future parity-test runner and it replays to the same
  // final state shown on the outro screen.
  private downloadTranscript(): void {
    if (this.phase !== "gameOver" || this.transcriptLen === 0) return;
    const buttons = this.transcriptBuf.subarray(0, this.transcriptLen);
    const bin = encodeTranscript(this.seed, buttons);
    const seedHex = (this.seed >>> 0).toString(16).padStart(8, "0");
    const name = `flight_scroll_seed${seedHex}_t${this.transcriptLen}_s${this.state.score}.bin`;
    const url = URL.createObjectURL(new Blob([bin], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Hand the captured run to the chain panel via a module-level buffer so
  // the player can submit it to the relay without a manual .bin upload.
  // Includes score + ticks so submit-ui can decide whether the run is
  // worth offering to submit at all.
  private publishTranscriptBuffer(): void {
    if (this.transcriptLen === 0) return;
    const buttons = this.transcriptBuf.subarray(0, this.transcriptLen);
    const bin = encodeTranscript(this.seed, buttons);
    setLatestRun({
      bytes: new Uint8Array(bin),
      score: this.state.score,
      ticks: this.state.tick,
    });
  }

  private makeSeed(): number {
    // Local seed — no contract round-trip on game start. The seed gets
    // committed in the proof's journal when the player submits a high
    // score, so the contract still binds (score, seed, player) together
    // even though the seed is player-chosen.
    return (Date.now() & 0xffffffff) | 0;
  }

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
