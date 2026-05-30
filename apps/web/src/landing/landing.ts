// Landing page — pixel-art card grid of available games. Mounts into
// document.body via main.ts when the URL is not a game slug.

import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import { Client, type HighScoreEntry } from "@flight/game-hub-client";
import { CONFIG, requireContractId } from "../chain/config.js";
import { syncLocalBest } from "../chain/score-sync.js";
import { connect, disconnect, getAddress, onWalletChange } from "../chain/wallet.js";
import { rewardsCalloutHtml } from "../ui/rewards-callout.js";
import { GAMES, type GameEntry } from "./games.js";

function strkeyToPubkey(strkey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(strkey));
}

function fmtAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function getReadClient(): Client {
  return new Client({
    contractId: requireContractId(),
    networkPassphrase: CONFIG.networkPassphrase,
    rpcUrl: CONFIG.rpcUrl,
    publicKey: undefined,
  });
}

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg: #0a1024;
    --bg-card: #16223a;
    --border: #3a4a6b;
    --border-bright: #6d8fff;
    --accent: #f5d04b;
    --pink: #ff79c6;
    --green: #7aff8e;
    --muted: #94a3c6;

    /* Two-font split:
         pixel — for headers + button labels; chunky, impact, hard to read at body sizes
         body  — for everything you actually need to scan or read */
    --font-pixel: 'Press Start 2P', ui-monospace, SFMono-Regular, Menlo, monospace;
    --font-body: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  #fs-landing {
    position: fixed;
    inset: 0;
    z-index: 200;
    background:
      radial-gradient(ellipse at top, #1a2750 0%, #0a1024 60%, #050a18 100%);
    color: #fff;
    font-family: var(--font-body);
    overflow-y: auto;
    image-rendering: pixelated;
  }

  /* Faint scanline overlay for CRT-ish feel */
  #fs-landing::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      to bottom,
      rgba(255,255,255,0.02) 0,
      rgba(255,255,255,0.02) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    z-index: 1;
  }

  /* Star field */
  #fs-landing .stars {
    position: absolute; inset: 0; pointer-events: none; z-index: 0;
  }
  #fs-landing .stars i {
    position: absolute;
    width: 2px; height: 2px;
    background: #fff;
    box-shadow: 0 0 0 0 rgba(255,255,255,0);
    opacity: 0.7;
  }

  /* Animated pixelated planes — they fly across the page leaving a
     fading exhaust trail. Each flight is a flex row [trail | plane]
     so the plane sits at the leading end of its trail. RTL flights
     get scaleX(-1) which flips the plane sprite AND the gradient,
     keeping the trail "behind" the plane regardless of direction. */
  #fs-landing .planes {
    position: absolute; inset: 0; pointer-events: none; z-index: 1;
    overflow: hidden;
  }
  #fs-landing .flight {
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    gap: 0;
    opacity: 0.55;
    /* The plane sits at the leading edge; trail fans out from it. */
    transform-origin: 50% 50%;
    will-change: transform;
  }
  #fs-landing .flight .trail {
    width: var(--trail-len, 100px);
    height: 2px;
    background: linear-gradient(to right, transparent 0%, currentColor 100%);
    margin-right: -1px; /* tuck under the plane's tail */
  }
  #fs-landing .flight .plane { line-height: 0; }
  #fs-landing .flight .plane svg {
    display: block;
    shape-rendering: crispEdges;
  }
  #fs-landing .flight.ltr {
    animation: fs-fly-ltr var(--speed, 22s) linear var(--delay, 0s) infinite;
  }
  #fs-landing .flight.rtl {
    animation: fs-fly-rtl var(--speed, 22s) linear var(--delay, 0s) infinite;
  }
  @keyframes fs-fly-ltr {
    from { transform: translateX(-30vw) rotate(var(--heading, 0deg)); }
    to   { transform: translateX(130vw) rotate(var(--heading, 0deg)); }
  }
  @keyframes fs-fly-rtl {
    /* scaleX(-1) flips both the plane sprite and the trail gradient,
       so the trail still trails behind even in the reverse direction. */
    from { transform: translateX(130vw) scaleX(-1) rotate(var(--heading, 0deg)); }
    to   { transform: translateX(-30vw) scaleX(-1) rotate(var(--heading, 0deg)); }
  }
  /* Respect reduced-motion preference — freeze the planes mid-flight. */
  @media (prefers-reduced-motion: reduce) {
    #fs-landing .flight { animation: none; }
  }

  /* Random Pacman drifting across the page background, eating a
     row of STATIC dots. The dots are absolutely positioned at fixed
     viewport-relative coordinates — they don't move. Each dot has
     its own keyframe (generated at mount time in makePacman) whose
     "eaten" frame fires at the exact cycle percentage when Pacman's
     wrapper translate has him crossing that dot's screen position.
     Both Pacman's translate and every dot's animation share the
     same duration + delay so they stay phase-locked across the
     infinite loop. */
  #fs-landing .pac-flight {
    position: absolute;
    left: 0;
    display: flex;
    align-items: center;
    /* Quieter than the active gameplay — Pacman is set-dressing,
       not the headline. */
    opacity: 0.5;
    will-change: transform;
    color: #ffd54f;
  }
  #fs-landing .pac-flight.ltr {
    animation: fs-fly-ltr var(--speed, 20s) linear var(--delay, 0s) infinite;
  }
  #fs-landing .pac-flight.rtl {
    animation: fs-fly-rtl var(--speed, 20s) linear var(--delay, 0s) infinite;
  }
  #fs-landing .pacman {
    width: 24px; height: 24px;
    background: currentColor;
    border-radius: 50%;
    /* Mouth wedge cut out of the right side; the wedge open angle
       cycles via the chomp keyframe to mime the eating motion. */
    clip-path: polygon(0 0, 100% 0, 100% 30%, 50% 50%, 100% 70%, 100% 100%, 0 100%);
    animation: fs-pac-chomp 0.32s steps(2) infinite alternate;
  }
  @keyframes fs-pac-chomp {
    from { clip-path: polygon(0 0, 100% 0, 100% 38%, 50% 50%, 100% 62%, 100% 100%, 0 100%); }
    to   { clip-path: polygon(0 0, 100% 0, 100% 12%, 50% 50%, 100% 88%, 100% 100%, 0 100%); }
  }
  /* Each individual pellet. Position is set inline. The keyframe
     name is also injected per-dot; default style is visible so dots
     show up before Pacman reaches them on the very first cycle. */
  #fs-landing .pac-dot {
    position: absolute;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #ffd54f;
    /* Baseline opacity — keyframes override per-dot to mime eating. */
    opacity: 0.55;
    transform: translate(-50%, -50%);
    /* faint glow so they read on the dark page without overwhelming */
    box-shadow: 0 0 3px rgba(255, 213, 79, 0.35);
    will-change: opacity, transform;
  }
  @media (prefers-reduced-motion: reduce) {
    #fs-landing .pac-flight,
    #fs-landing .pacman,
    #fs-landing .pac-dot { animation: none; }
  }

  #fs-landing .topnav {
    position: relative;
    z-index: 3;
    max-width: 880px;
    margin: 0 auto;
    padding: 20px 24px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
  }
  #fs-landing .topnav .left {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  #fs-landing .topnav .right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* Plain text links on the left (Leaderboards, How it works) */
  #fs-landing .topnav .link {
    background: transparent;
    color: var(--muted);
    text-decoration: none;
    font-family: var(--font-body);
    font-size: 13px;
    font-weight: 500;
    padding: 6px 10px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }
  #fs-landing .topnav .link:hover {
    color: var(--accent);
    border-color: var(--border);
  }
  /* Real button styling for sign in / sign out / address on the right */
  #fs-landing .topnav .btn {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border: 2px solid #8a6df0;
    border-radius: 6px;
    font-family: var(--font-pixel);
    font-size: 11px;
    letter-spacing: 0.5px;
    padding: 9px 16px;
    cursor: pointer;
    transition: background 0.1s, transform 0.08s;
  }
  #fs-landing .topnav .btn:hover {
    background: linear-gradient(135deg, #6d4ac0 0%, #3a72e8 100%);
    transform: translateY(-1px);
  }
  #fs-landing .topnav .btn:active { transform: translateY(0); }
  #fs-landing .topnav .btn.ghost {
    background: transparent;
    color: var(--muted);
    border-color: var(--border);
    font-family: var(--font-body);
    font-size: 12px;
    letter-spacing: normal;
    padding: 7px 12px;
  }
  #fs-landing .topnav .btn.ghost:hover {
    color: var(--accent);
    border-color: var(--accent);
    background: transparent;
  }
  #fs-landing .topnav .addr {
    font-family: var(--font-body);
    font-size: 12px;
    color: #d0d8ee;
    background: rgba(255,255,255,0.06);
    padding: 6px 10px;
    border-radius: 4px;
  }

  #fs-landing .signin-banner {
    background: rgba(245, 208, 75, 0.08);
    border: 1px dashed rgba(245, 208, 75, 0.4);
    color: #f5d04b;
    font-size: 13px;
    padding: 10px 16px;
    margin: 0 auto 32px;
    max-width: 480px;
    border-radius: 4px;
  }
  #fs-landing .signin-banner button {
    background: transparent;
    color: var(--accent);
    border: none;
    font-family: var(--font-body);
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }
  #fs-landing .signin-banner button:hover { color: #fff; }

  #fs-landing .inner {
    position: relative;
    z-index: 2;
    max-width: 880px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    text-align: center;
  }

  #fs-landing h1 {
    font-family: var(--font-pixel);
    font-size: 36px;
    line-height: 1.05;
    margin: 0 0 22px;
    letter-spacing: 1px;
    color: #fff;
    text-shadow:
      3px 0 0 #5b3aa8,
      6px 3px 0 #2c5dd0,
      9px 6px 0 rgba(0,0,0,0.4);
  }
  #fs-landing h1 .sub {
    font-size: 22px;
    color: var(--accent);
    text-shadow:
      3px 0 0 #6b4a08,
      6px 3px 0 rgba(0,0,0,0.4);
  }

  #fs-landing .subtitle {
    font-size: 14px;
    color: var(--muted);
    margin: 0 0 56px;
    line-height: 1.6;
    letter-spacing: 0.2px;
  }
  #fs-landing .subtitle .accent { color: var(--accent); font-weight: 600; }

  #fs-landing .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 28px;
    margin-bottom: 56px;
  }

  #fs-landing .card {
    background: var(--bg-card);
    border: 4px solid var(--border);
    /* chunky multi-pixel "shadow" via stacked solid box-shadows */
    box-shadow:
      4px 4px 0 var(--border),
      8px 8px 0 rgba(0,0,0,0.5);
    padding: 20px;
    text-align: left;
    cursor: pointer;
    transition: transform 0.08s linear, border-color 0.08s linear;
    text-decoration: none;
    color: inherit;
    display: block;
  }
  #fs-landing .card.live:hover {
    border-color: var(--border-bright);
    transform: translate(-2px, -2px);
    box-shadow:
      6px 6px 0 var(--border-bright),
      12px 12px 0 rgba(0,0,0,0.5);
  }
  #fs-landing .card.live:active {
    transform: translate(2px, 2px);
    box-shadow:
      2px 2px 0 var(--border),
      4px 4px 0 rgba(0,0,0,0.5);
  }
  #fs-landing .card.soon {
    opacity: 0.55;
    cursor: not-allowed;
  }

  #fs-landing .card .thumb {
    width: 100%;
    height: 120px;
    background: #07101f;
    border: 2px solid var(--border);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  #fs-landing .card .thumb img {
    image-rendering: pixelated;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  #fs-landing .card .perk {
    background: linear-gradient(90deg, #b48a00 0%, #f5d04b 50%, #b48a00 100%);
    color: #20140a;
    font-size: 12px;
    font-weight: 600;
    padding: 8px 12px;
    margin: -20px -20px 16px;
    border-bottom: 2px solid #6b4a08;
    letter-spacing: 0.3px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  #fs-landing .card .perk::before {
    content: '★';
    font-size: 14px;
  }
  #fs-landing .card .perk a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  #fs-landing .card h2 {
    font-family: var(--font-pixel);
    font-size: 16px;
    margin: 0 0 12px;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  #fs-landing .card .blurb {
    font-size: 14px;
    font-weight: 500;
    color: #e3e8f6;
    line-height: 1.5;
    margin-bottom: 12px;
  }
  #fs-landing .card .desc {
    font-size: 13px;
    color: var(--muted);
    line-height: 1.6;
    margin-bottom: 18px;
  }

  #fs-landing .card .best {
    margin-bottom: 14px;
    padding: 8px 12px;
    background: rgba(245, 208, 75, 0.1);
    border-left: 3px solid var(--accent);
    font-size: 12px;
    color: #d8e0f0;
  }
  #fs-landing .card .best .label { color: var(--muted); }
  #fs-landing .card .best .val {
    font-family: var(--font-pixel);
    font-size: 14px;
    color: var(--accent);
    margin-left: 6px;
    vertical-align: middle;
  }
  #fs-landing .card .best.empty {
    background: transparent;
    border-left-color: var(--border);
    color: var(--muted);
    font-style: italic;
  }

  #fs-landing .card .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  #fs-landing .card .play,
  #fs-landing .card .leaderboard {
    display: inline-block;
    text-decoration: none;
    padding: 10px 16px;
    border-width: 2px;
    border-style: solid;
    font-family: var(--font-pixel);
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  #fs-landing .card .play {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border-color: #8a6df0;
  }
  #fs-landing .card .leaderboard {
    background: transparent;
    color: var(--accent);
    border-color: var(--border);
  }
  #fs-landing .card .leaderboard:hover {
    border-color: var(--accent);
  }
  #fs-landing .card.soon .play,
  #fs-landing .card.soon .leaderboard {
    background: #2a2f3f;
    border-color: #3a4456;
    color: #7a86a4;
    pointer-events: none;
  }
  #fs-landing .card.soon .thumb img {
    filter: grayscale(0.6);
  }

  #fs-landing .footer {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.6;
    margin-top: 32px;
  }
  #fs-landing .footer a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }
  #fs-landing .footer a:hover { text-decoration: underline; }

  @media (max-width: 560px) {
    #fs-landing h1 { font-size: 24px; }
    #fs-landing h1 .sub { font-size: 16px; }
    #fs-landing .subtitle { font-size: 12px; margin-bottom: 36px; }
    #fs-landing .inner { padding: 36px 16px 64px; }
    #fs-landing .card h2 { font-size: 13px; }
    #fs-landing .card .blurb { font-size: 13px; }
    #fs-landing .card .desc { font-size: 12px; }
  }
`;

function makeStars(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "stars";
  // 60 deterministic-ish stars seeded so they don't shift on each mount
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 60; i++) {
    const s = document.createElement("i");
    s.style.left = `${rand() * 100}%`;
    s.style.top = `${rand() * 100}%`;
    const sz = Math.round(rand() * 2) + 1;
    s.style.width = `${sz}px`;
    s.style.height = `${sz}px`;
    s.style.opacity = String(0.3 + rand() * 0.6);
    wrap.appendChild(s);
  }
  return wrap;
}

/// Pixel-art prop-plane SVG facing right (positive X). 18 wide × 10 tall
/// in viewBox space, scaled to 20×11 in CSS for that chunky-but-readable
/// landing-page feel. `currentColor` lets each flight pick its own hue.
const PLANE_SVG = `
  <svg viewBox="0 0 18 10" width="22" height="12" fill="currentColor"
       xmlns="http://www.w3.org/2000/svg">
    <!-- tail horizontal stabilizer -->
    <rect x="0" y="3" width="2" height="1"/>
    <rect x="0" y="6" width="2" height="1"/>
    <!-- tail vertical fin -->
    <rect x="2" y="2" width="1" height="2"/>
    <!-- fuselage -->
    <rect x="2" y="4" width="14" height="2"/>
    <!-- wing perpendicular to fuselage (top + bottom from side view) -->
    <rect x="8" y="1" width="2" height="3"/>
    <rect x="8" y="6" width="2" height="3"/>
    <!-- nose taper -->
    <rect x="16" y="4" width="1" height="2"/>
    <!-- propeller disc (vertical line at front) -->
    <rect x="17" y="3" width="1" height="4"/>
  </svg>
`;

/// Spawn one Pacman with a row of static pellets it eats as it flies
/// across the page. Pellet eating is achieved via per-pellet keyframes
/// whose "eaten" frame fires at the exact % of the cycle when Pacman's
/// translate has him on top of that pellet — both animations share the
/// same duration + delay so they remain phase-locked across iterations.
function makePacman(host: HTMLElement): void {
  const dir = Math.random() < 0.5 ? "ltr" : "rtl";
  const D = 20 + Math.floor(Math.random() * 8);        // 20-28s flight
  const topPct = 22 + Math.floor(Math.random() * 50);  // 22-72%
  const startDelay = -Math.floor(Math.random() * D);   // staggered start
  // Heading stays flat so the dots stay perfectly aligned with Pacman's
  // path — a tilted Pacman would drift above/below the pellet row.

  // Pacman wrapper — uses the same fs-fly-ltr / fs-fly-rtl keyframes
  // the planes use, so the translate matches `-30vw → 130vw` (LTR) or
  // `130vw → -30vw` (RTL) over duration D. The 12px upward offset
  // (half the Pacman sprite's height) puts Pacman's CENTER on the
  // pellet row instead of its top edge — without it the chomp lands
  // a hair below the dots it's supposed to be eating.
  const flight = document.createElement("div");
  flight.className = `pac-flight ${dir}`;
  flight.innerHTML = `<div class="pacman"></div>`;
  flight.style.top = `calc(${topPct}% - 12px)`;
  flight.style.setProperty("--speed", `${D}s`);
  flight.style.setProperty("--delay", `${startDelay}s`);
  flight.style.setProperty("--heading", "0deg");
  host.appendChild(flight);

  // Pellets — spread evenly across the viewport horizontally at the
  // same altitude as Pacman. Quantity chosen so they read as a row.
  const DOTS = 9;
  // Pacman's leading edge sweeps from -30vw to 130vw over D seconds,
  // covering 160vw of horizontal distance. Convert a pellet's `left`
  // coordinate (in vw) into the cycle fraction where Pacman crosses it.
  const sweep = 160;
  const xToCycleFrac = (xVw: number) =>
    dir === "ltr"
      ? (xVw + 30) / sweep   // -30vw at 0, 130vw at 100%
      : (130 - xVw) / sweep; // 130vw at 0, -30vw at 100%

  // Inject a per-pellet @keyframes that holds opacity:1 until the eat
  // moment, then drops to 0 with a tiny scale pop. Single stylesheet
  // appended to head; one rule per pellet across this Pacman flight.
  const styleEl = document.createElement("style");
  let css = "";
  // Random suffix so multiple Pacman invocations (or HMR reloads)
  // don't collide on keyframe names.
  const tag = Math.random().toString(36).slice(2, 8);

  for (let i = 0; i < DOTS; i++) {
    // 8-92 vw — keep pellets fully on-screen
    const xVw = 8 + (i / (DOTS - 1)) * 84;
    const p = xToCycleFrac(xVw);
    // Skip pellets that would be eaten outside [0, 100%] — shouldn't
    // happen for these vw values but defensive.
    if (p < 0 || p > 1) continue;
    const eatPct = (p * 100).toFixed(2);
    const visiblePct = Math.max(0, p * 100 - 0.6).toFixed(2);
    const eatenPct = Math.min(100, p * 100 + 0.6).toFixed(2);
    const kf = `fs-pac-dot-${tag}-${i}`;
    css += `
      @keyframes ${kf} {
        0% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
        ${visiblePct}% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
        ${eatPct}% { opacity: 0; transform: translate(-50%, -50%) scale(1.7); }
        ${eatenPct}%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.7); }
      }
    `;

    const dot = document.createElement("div");
    dot.className = "pac-dot";
    dot.style.left = `${xVw}vw`;
    dot.style.top = `${topPct}%`;
    // Same duration + delay as the Pacman flight → phase-locked.
    dot.style.animation = `${kf} ${D}s linear ${startDelay}s infinite`;
    host.appendChild(dot);
  }
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

function makePlanes(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "planes";

  // Seeded RNG so the flight pattern is deterministic across reloads —
  // visitors aren't distracted by reshuffling planes mid-scroll.
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // Palette pulled from the page's own accents so the planes feel
  // native to the existing color story.
  const colors = ["#f5d04b", "#7aff8e", "#ff9c5b", "#9bbcff"];
  const COUNT = 7;

  for (let i = 0; i < COUNT; i++) {
    const flight = document.createElement("div");
    const direction = rand() < 0.5 ? "ltr" : "rtl";
    flight.className = `flight ${direction}`;
    flight.innerHTML = `<div class="trail"></div><div class="plane">${PLANE_SVG}</div>`;
    // Spread across the upper 85% of the page so planes don't cluster
    // through the card grid at the bottom.
    const topPct = 6 + Math.floor(rand() * 80);
    const speedSec = 22 + Math.floor(rand() * 16); // 22-38s slow drift
    // Negative delay puts each flight mid-route at first paint — no
    // empty sky waiting for the first plane to enter from the edge.
    const delaySec = -Math.floor(rand() * speedSec);
    const trailLen = 90 + Math.floor(rand() * 80); // 90-170px
    const color = colors[Math.floor(rand() * colors.length)];
    const heading = (rand() * 8 - 4).toFixed(1); // -4° to +4° drift
    flight.style.top = `${topPct}%`;
    flight.style.color = color!;
    flight.style.setProperty("--speed", `${speedSec}s`);
    flight.style.setProperty("--delay", `${delaySec}s`);
    flight.style.setProperty("--trail-len", `${trailLen}px`);
    flight.style.setProperty("--heading", `${heading}deg`);
    wrap.appendChild(flight);
  }

  return wrap;
}

function makeCard(g: GameEntry): HTMLElement {
  // Outer card is a div now (not an <a>) so the leaderboard link inside
  // doesn't conflict with the main card click target.
  const card = document.createElement("div");
  card.className = `card ${g.status}`;
  card.dataset.slug = g.slug;

  const perkHtml = g.perk
    ? `<div class="perk">${
        g.perk.url
          ? `<a href="${g.perk.url}" target="_blank" rel="noopener">${g.perk.text}</a>`
          : g.perk.text
      }</div>`
    : "";

  const isLive = g.status === "live";
  const playHref = isLive ? `/${g.slug}` : "#";
  const lbHref = isLive ? `/${g.slug}/leaderboard` : "#";

  card.innerHTML = `
    ${perkHtml}
    <div class="thumb">
      <img src="${g.thumb}" alt="${g.title}" onerror="this.style.display='none'">
    </div>
    <h2>${g.title}</h2>
    <div class="blurb">${g.blurb}</div>
    <div class="desc">${g.description}</div>
    ${isLive ? rewardsCalloutHtml({ compact: true }) : ""}
    <div class="best" data-best style="display:none;"></div>
    <div class="actions">
      <a href="${playHref}" class="play"${isLive ? "" : ' onclick="event.preventDefault()"'}>
        ${isLive ? "▶ PLAY" : "COMING SOON"}
      </a>
      <a href="${lbHref}" class="leaderboard"${isLive ? "" : ' onclick="event.preventDefault()"'}>📊 LEADERBOARD</a>
    </div>
  `;
  return card;
}

/// Fetch get_score for every live game, render an inline best chip on
/// each card, and hydrate localStorage so the in-game HUD's BEST
/// counter matches the chain on fresh browsers. Called when the
/// wallet connects.
async function refreshAllBests(addr: string): Promise<void> {
  if (!CONFIG.gameHubContractId) return;
  const client = getReadClient();
  const pubkey = strkeyToPubkey(addr);

  for (const g of GAMES) {
    if (g.status !== "live" || g.gameId === undefined) continue;
    const card = document.querySelector<HTMLElement>(`.card[data-slug="${g.slug}"] [data-best]`);
    if (!card) continue;
    card.style.display = "block";
    card.innerHTML = `<span class="label">loading your best…</span>`;
    try {
      const res = await client.get_score({
        game_id: g.gameId,
        player_pubkey: pubkey,
      });
      const entry = (res.result as HighScoreEntry | undefined) ?? null;
      if (entry) {
        card.classList.remove("empty");
        card.innerHTML = `<span class="label">your best</span><span class="val">${entry.score}</span>`;
        syncLocalBest(g.slug, entry.score);
      } else {
        card.classList.add("empty");
        card.innerHTML = `no score yet — set one`;
      }
    } catch (e) {
      card.classList.add("empty");
      card.innerHTML = `<span class="label">couldn't load best (${e instanceof Error ? e.message.slice(0, 40) : "error"})</span>`;
    }
  }
}

function clearAllBests(): void {
  document.querySelectorAll<HTMLElement>(`.card [data-best]`).forEach((el) => {
    el.style.display = "none";
    el.innerHTML = "";
    el.classList.remove("empty");
  });
}

export function mountLanding(): void {
  // Inject the stylesheet once.
  if (!document.getElementById("fs-landing-style")) {
    const s = document.createElement("style");
    s.id = "fs-landing-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const root = document.createElement("div");
  root.id = "fs-landing";

  root.appendChild(makeStars());
  const planes = makePlanes();
  makePacman(planes); // ride in the same z-index layer as the planes
  root.appendChild(planes);

  const nav = document.createElement("div");
  nav.className = "topnav";
  nav.innerHTML = `
    <div class="left">
      <a class="link" href="/leaderboard">📊 LEADERBOARDS</a>
      <a class="link" href="/how-it-works">⚙️ HOW IT WORKS</a>
      <a class="link" href="/contracts">📜 CONTRACTS</a>
    </div>
    <div class="right" id="fs-topnav-wallet"></div>
  `;
  root.appendChild(nav);

  const inner = document.createElement("div");
  inner.className = "inner";
  inner.innerHTML = `
    <h1>PROOFWORKS<br><span class="sub">ARCADE</span></h1>
    <p class="subtitle">
      <span class="accent">verified</span> high scores · on-chain
    </p>
    <div class="signin-banner" id="fs-signin-banner" style="display:none;"></div>
    <div class="grid" id="fs-landing-grid"></div>
    <div class="footer">
      leaderboards on stellar · <a href="https://github.com/enderNakamoto/flight_runner" target="_blank">github</a>
    </div>
  `;
  root.appendChild(inner);

  const grid = inner.querySelector<HTMLElement>("#fs-landing-grid")!;
  for (const g of GAMES) grid.appendChild(makeCard(g));

  // Hide the Phaser canvas while landing is up.
  const game = document.getElementById("game");
  if (game) game.style.display = "none";

  document.body.appendChild(root);

  // ── Sign-in wiring ─────────────────────────────────────────────────
  const walletSlot = root.querySelector<HTMLElement>("#fs-topnav-wallet")!;
  const banner = root.querySelector<HTMLElement>("#fs-signin-banner")!;

  async function doSignIn(): Promise<void> {
    try {
      await connect();
      // onWalletChange will re-render and fetch bests.
    } catch {
      // User cancelled wallet picker — no banner, no error toast,
      // they can hit Sign In again whenever.
    }
  }

  function renderTopnavWallet(addr: string | null): void {
    walletSlot.innerHTML = "";
    if (addr) {
      const addrEl = document.createElement("span");
      addrEl.className = "addr";
      addrEl.textContent = fmtAddress(addr);
      walletSlot.appendChild(addrEl);

      const dc = document.createElement("button");
      dc.className = "btn ghost";
      dc.textContent = "SIGN OUT";
      dc.onclick = () => disconnect();
      walletSlot.appendChild(dc);
    } else {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = "SIGN IN";
      btn.onclick = doSignIn;
      walletSlot.appendChild(btn);
    }
  }

  function renderBanner(addr: string | null): void {
    if (addr) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "block";
    banner.innerHTML = `
      <strong>Sign in</strong> to see your best scores on-chain.
      <button id="fs-banner-signin">Sign in now</button>
    `;
    banner.querySelector<HTMLButtonElement>("#fs-banner-signin")!.onclick = doSignIn;
  }

  onWalletChange((addr) => {
    renderTopnavWallet(addr);
    renderBanner(addr);
    if (addr) refreshAllBests(addr).catch(() => {});
    else clearAllBests();
  });
}
