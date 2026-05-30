// /how-it-works — game-agnostic explainer of the play → proof → chain
// pipeline that powers every game on the arcade. Pixel-art house style,
// SVG illustrations + CSS animation. No external assets so the page
// boots fast and works offline.

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

  :root {
    --bg-card: #16223a;
    --border: #3a4a6b;
    --border-bright: #6d8fff;
    --accent: #f5d04b;
    --muted: #94a3c6;
    --font-pixel: 'Press Start 2P', ui-monospace, Menlo, monospace;
    --font-body: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  }

  #fs-how {
    position: fixed; inset: 0; z-index: 200;
    background: radial-gradient(ellipse at top, #1a2750 0%, #0a1024 60%, #050a18 100%);
    color: #fff;
    font-family: var(--font-body);
    overflow-y: auto;
  }
  #fs-how .topnav {
    max-width: 980px; margin: 0 auto;
    padding: 20px 24px 0;
    display: flex; justify-content: space-between; align-items: center;
  }
  #fs-how .topnav a {
    color: var(--muted);
    text-decoration: none;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid transparent;
  }
  #fs-how .topnav a:hover {
    color: var(--accent);
    border-color: var(--border);
  }

  #fs-how .inner {
    max-width: 980px; margin: 0 auto;
    padding: 24px 24px 96px;
  }
  #fs-how h1 {
    font-family: var(--font-pixel);
    font-size: 30px;
    text-align: center;
    margin: 16px 0 14px;
    text-shadow:
      3px 0 0 #5b3aa8,
      6px 3px 0 #2c5dd0,
      9px 6px 0 rgba(0,0,0,0.4);
    line-height: 1.1;
  }
  #fs-how .lede {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    margin: 0 auto 28px;
    max-width: 640px;
  }

  /* Intro paragraph — plain-English narrative ABOVE the flow strip. */
  #fs-how .intro {
    background: var(--bg-card);
    border-left: 4px solid var(--accent);
    padding: 18px 22px;
    margin: 0 auto 36px;
    max-width: 760px;
    font-size: 14px;
    line-height: 1.75;
    color: #d8e0f0;
  }
  #fs-how .intro strong { color: #fff; }

  /* Animated banner — the ✈️ emoji glides along a dashed highway.
     The emoji is drawn pointing upper-right on most platforms; a static
     CSS rotation on an inner wrapper brings the nose to due east. The
     outer wrapper handles the translation animation so the two
     transforms don't fight each other. No wobble — it just glides. */
  #fs-how .sky {
    position: relative;
    height: 64px;
    margin-bottom: 14px;
    overflow: hidden;
  }
  #fs-how .sky::after {
    content: '';
    position: absolute;
    left: 0; right: 0; top: 32px;
    height: 0;
    border-top: 2px dashed rgba(245, 208, 75, 0.18);
  }
  #fs-how .plane-fly {
    /* Anchor at vertical center of the strip (32 px) — translateY(-50%)
       centers the inner emoji wrapper on the dashed track. */
    position: absolute;
    top: 32px;
    left: 0;
    display: inline-block;
    animation: fs-fly 22s linear infinite;
  }
  #fs-how .plane-fly .plane {
    display: inline-block;
    font-size: 30px;
    line-height: 1;
    /* Pull the glyph up by half its line-height so it sits ON the
       dashed track, not below it. */
    transform: translateY(-50%) rotate(45deg);
    transform-origin: 50% 50%;
    filter: drop-shadow(0 0 6px rgba(245, 208, 75, 0.35));
  }
  @keyframes fs-fly {
    0%   { transform: translateX(-50px); }
    100% { transform: translateX(calc(100vw + 50px)); }
  }

  /* Snake / boustrophedon layout:
       row 1 (left → right):  PLAY  ▶  SIM  ▶  PROOF
                                                ▼
       row 2 (right → left):       ON-CHAIN  ◀  WRAP
     Bigger cards (3-col grid instead of 5) so each step has room to breathe;
     arrows connect cards directionally rather than every gap being the same. */
  #fs-how .flow {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: 36px;
    row-gap: 60px;
    margin-bottom: 36px;
  }
  #fs-how .step {
    background: var(--bg-card);
    border: 3px solid var(--border);
    box-shadow: 4px 4px 0 var(--border);
    padding: 24px 18px;
    text-align: center;
    position: relative;
    min-height: 240px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  #fs-how .step .icon {
    width: 96px;
    height: 96px;
    margin: 0 auto 14px;
    display: block;
  }
  #fs-how .step h3 {
    font-family: var(--font-pixel);
    font-size: 13px;
    color: var(--accent);
    margin: 0 0 12px;
    letter-spacing: 0.5px;
    line-height: 1.3;
  }
  #fs-how .step p {
    font-size: 13px;
    line-height: 1.6;
    color: #d0d8ee;
    margin: 0 0 12px;
  }
  #fs-how .step .tag {
    font-family: var(--font-pixel);
    font-size: 8px;
    color: var(--muted);
    display: block;
    margin-top: auto;
    letter-spacing: 0.3px;
  }

  /* Grid placement (snake):
       step 1 (PLAY)     → row 1 col 1
       step 2 (SIM)      → row 1 col 2
       step 3 (PROOF)    → row 1 col 3
       step 4 (WRAP)     → row 2 col 3   (directly under PROOF)
       step 5 (ON-CHAIN) → row 2 col 2   (left of WRAP) */
  #fs-how .step:nth-child(4) { grid-area: 2 / 3; }
  #fs-how .step:nth-child(5) { grid-area: 2 / 2; }

  /* Arrows — chunky glyphs at large font-size so they read clearly
     in the gaps between cards. Pulse animation uses a high min-opacity
     so they're always plainly visible, not just at peak. */
  #fs-how .step::after { pointer-events: none; }
  #fs-how .step:nth-child(1)::after,
  #fs-how .step:nth-child(2)::after {
    content: '➤';
    position: absolute;
    right: -32px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--accent);
    font-size: 36px;
    line-height: 1;
    z-index: 2;
    animation: fs-pulse-arrow 1.6s ease-in-out infinite;
    text-shadow: 0 0 12px rgba(245,208,75,0.7);
  }
  #fs-how .step:nth-child(3)::after {
    content: '➤';
    position: absolute;
    bottom: -54px;
    left: 50%;
    /* Rotate the same arrowhead 90deg so it points down — keeps the
       glyph style consistent across all four arrows. */
    transform: translateX(-50%) rotate(90deg);
    color: var(--accent);
    font-size: 36px;
    line-height: 1;
    z-index: 2;
    animation: fs-pulse-arrow-v 1.6s ease-in-out infinite;
    text-shadow: 0 0 12px rgba(245,208,75,0.7);
  }
  #fs-how .step:nth-child(4)::after {
    content: '➤';
    position: absolute;
    left: -32px;
    top: 50%;
    transform: translateY(-50%) rotate(180deg);
    color: var(--accent);
    font-size: 36px;
    line-height: 1;
    z-index: 2;
    animation: fs-pulse-arrow-left 1.6s ease-in-out infinite;
    text-shadow: 0 0 12px rgba(245,208,75,0.7);
  }
  @keyframes fs-pulse-arrow {
    0%, 100% { opacity: 0.8; transform: translateY(-50%) translateX(0); }
    50%      { opacity: 1;   transform: translateY(-50%) translateX(5px); }
  }
  @keyframes fs-pulse-arrow-v {
    /* Vertical arrow is rotated 90deg; the rotation stays through both
       frames, only the y-offset oscillates. */
    0%, 100% { opacity: 0.8; transform: translateX(-50%) rotate(90deg) translateX(0); }
    50%      { opacity: 1;   transform: translateX(-50%) rotate(90deg) translateX(5px); }
  }
  @keyframes fs-pulse-arrow-left {
    /* Left arrow is rotated 180deg; keep the rotation and pulse the
       relative-X by translating along its rotated x-axis. */
    0%, 100% { opacity: 0.8; transform: translateY(-50%) rotate(180deg) translateX(0); }
    50%      { opacity: 1;   transform: translateY(-50%) rotate(180deg) translateX(5px); }
  }

  /* "Behind the scenes" — three backends. */
  #fs-how .backends {
    margin: 40px auto 24px;
    max-width: 760px;
  }
  #fs-how .backends-head {
    text-align: center;
    margin-bottom: 18px;
  }
  #fs-how .backends-head h2 {
    font-family: var(--font-pixel);
    font-size: 16px;
    color: var(--accent);
    margin: 0 0 6px;
    letter-spacing: 0.5px;
  }
  #fs-how .backends-head .sub {
    color: var(--muted);
    font-size: 13px;
  }
  #fs-how .backend {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 4px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  #fs-how .backend[open] {
    border-color: var(--border-bright);
  }
  #fs-how .backend summary {
    cursor: pointer;
    padding: 14px 18px;
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    user-select: none;
  }
  #fs-how .backend summary::-webkit-details-marker { display: none; }
  #fs-how .backend summary .left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  #fs-how .backend summary .caret {
    color: var(--muted);
    font-family: var(--font-pixel);
    font-size: 10px;
    width: 14px;
  }
  #fs-how .backend[open] summary .caret { color: var(--accent); }
  #fs-how .backend summary .label {
    font-family: var(--font-pixel);
    font-size: 12px;
    letter-spacing: 0.5px;
  }
  #fs-how .backend summary .tags {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  #fs-how .backend summary .pill {
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 2px 7px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  #fs-how .backend summary .pill.live {
    color: #7aff8e;
    border-color: #7aff8e;
  }
  #fs-how .backend .body {
    padding: 6px 18px 18px;
    color: #d0d8ee;
    font-size: 13px;
    line-height: 1.7;
    border-top: 1px dashed var(--border);
  }
  #fs-how .backend .body p { margin: 10px 0; }
  #fs-how .backend .body strong { color: #fff; }
  #fs-how .backend .body .when {
    color: var(--accent);
    font-size: 12px;
    margin-top: 12px;
  }

  /* "Verified" stamp */
  #fs-how .verdict {
    margin-top: 8px;
    text-align: center;
  }
  #fs-how .verdict .stamp {
    display: inline-block;
    padding: 18px 32px;
    border: 3px dashed #7aff8e;
    color: #7aff8e;
    font-family: var(--font-pixel);
    font-size: 16px;
    letter-spacing: 1px;
    transform: rotate(-3deg);
    border-radius: 6px;
    box-shadow: 0 0 30px rgba(122,255,142,0.1);
  }

  /* Closing paragraph — the "why this matters" payoff. */
  #fs-how .outro {
    margin: 40px auto 0;
    max-width: 720px;
    padding: 0 12px;
    text-align: center;
    color: #d0d8ee;
    font-size: 14px;
    line-height: 1.8;
  }
  #fs-how .outro strong { color: var(--accent); }
  #fs-how .outro .tech {
    margin-top: 14px;
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.2px;
  }

  /* Single back-to-arcade CTA at the bottom — no game-specific links. */
  #fs-how .cta {
    margin-top: 44px;
    text-align: center;
  }
  #fs-how .cta a {
    font-family: var(--font-pixel);
    font-size: 11px;
    padding: 12px 22px;
    text-decoration: none;
    border-radius: 8px;
    letter-spacing: 0.5px;
    background: transparent;
    color: var(--muted);
    border: 2px solid var(--border);
  }
  #fs-how .cta a:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  @media (max-width: 760px) {
    #fs-how .flow {
      grid-template-columns: 1fr;
      row-gap: 40px;
    }
    /* Collapse the snake into a straight downward column on small screens.
       Every step (except the last) shows a ▼ arrow below it. */
    #fs-how .step:nth-child(4),
    #fs-how .step:nth-child(5) {
      grid-area: auto;
    }
    #fs-how .step:nth-child(1)::after,
    #fs-how .step:nth-child(2)::after,
    #fs-how .step:nth-child(3)::after,
    #fs-how .step:nth-child(4)::after {
      content: '▼';
      right: auto;
      left: 50%;
      top: auto;
      bottom: -32px;
      transform: translateX(-50%);
      animation: fs-pulse-arrow-v 1.6s ease-in-out infinite;
    }
    #fs-how h1 { font-size: 22px; }
    #fs-how .intro { font-size: 13px; padding: 14px 18px; }
    #fs-how .step { min-height: auto; }
  }
`;

// SVG icons — chunky stick-figure / blocky style. Each fits in 72×72.
// Game-agnostic — no plane / pilot specifics, just abstract "data" + math.
const ICON_PLAY = `
  <svg class="icon" viewBox="0 0 72 72" fill="none" stroke="#f5d04b" stroke-width="3" stroke-linecap="square">
    <circle cx="36" cy="18" r="6"/>
    <line x1="36" y1="24" x2="36" y2="46"/>
    <line x1="36" y1="30" x2="24" y2="38"/>
    <line x1="36" y1="30" x2="48" y2="38"/>
    <line x1="36" y1="46" x2="28" y2="62"/>
    <line x1="36" y1="46" x2="44" y2="62"/>
    <!-- mini controller -->
    <rect x="46" y="36" width="18" height="10" rx="2" fill="#5b3aa8" stroke="#8a6df0"/>
    <circle cx="50" cy="41" r="1.5" fill="#f5d04b" stroke="none"/>
    <circle cx="60" cy="41" r="1.5" fill="#f5d04b" stroke="none"/>
  </svg>
`;
const ICON_SIM = `
  <svg class="icon" viewBox="0 0 72 72" fill="none" stroke="#7aff8e" stroke-width="3" stroke-linecap="square">
    <!-- tape reels turning, suggestion of a deterministic playback machine -->
    <rect x="8" y="16" width="56" height="40" rx="2"/>
    <circle cx="22" cy="36" r="9" fill="rgba(122,255,142,0.06)"/>
    <circle cx="50" cy="36" r="9" fill="rgba(122,255,142,0.06)"/>
    <line x1="22" y1="36" x2="26" y2="30"/>
    <line x1="22" y1="36" x2="18" y2="42"/>
    <line x1="50" y1="36" x2="54" y2="30"/>
    <line x1="50" y1="36" x2="46" y2="42"/>
    <line x1="31" y1="36" x2="41" y2="36"/>
  </svg>
`;
const ICON_STARK = `
  <svg class="icon" viewBox="0 0 72 72" fill="none" stroke="#9be7ff" stroke-width="3" stroke-linecap="square">
    <!-- a parchment of math -->
    <path d="M14 8 L52 8 L60 14 L60 64 L14 64 Z" fill="rgba(155,231,255,0.06)"/>
    <line x1="22" y1="20" x2="52" y2="20"/>
    <line x1="22" y1="28" x2="52" y2="28"/>
    <line x1="22" y1="36" x2="42" y2="36"/>
    <line x1="22" y1="44" x2="52" y2="44"/>
    <line x1="22" y1="52" x2="36" y2="52"/>
    <!-- corner fold -->
    <path d="M52 8 L60 14 L52 14 Z" fill="rgba(155,231,255,0.18)" stroke="none"/>
  </svg>
`;
const ICON_GROTH = `
  <svg class="icon" viewBox="0 0 72 72" fill="none" stroke="#f5d04b" stroke-width="3" stroke-linecap="square">
    <!-- a sealed envelope / compact bundle -->
    <rect x="10" y="20" width="52" height="34" rx="2" fill="rgba(245,208,75,0.08)"/>
    <path d="M10 22 L36 40 L62 22"/>
    <!-- wax seal -->
    <circle cx="36" cy="46" r="6" fill="#f5d04b" stroke="none"/>
    <circle cx="36" cy="46" r="3" fill="#20140a" stroke="none"/>
  </svg>
`;
const ICON_CHAIN = `
  <svg class="icon" viewBox="0 0 72 72" fill="none" stroke="#ff79c6" stroke-width="3" stroke-linecap="square">
    <!-- three blocks linked, with a check on the last -->
    <rect x="4" y="26" width="18" height="20" fill="rgba(255,121,198,0.06)"/>
    <rect x="26" y="26" width="20" height="20" fill="rgba(255,121,198,0.06)"/>
    <rect x="50" y="26" width="18" height="20" fill="rgba(255,121,198,0.08)"/>
    <line x1="22" y1="36" x2="26" y2="36"/>
    <line x1="46" y1="36" x2="50" y2="36"/>
    <!-- check on the rightmost block -->
    <polyline points="54,36 58,40 64,32" stroke="#7aff8e" stroke-width="3" fill="none"/>
  </svg>
`;

export function mountHowItWorks(): void {
  if (!document.getElementById("fs-how-style")) {
    const s = document.createElement("style");
    s.id = "fs-how-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const root = document.createElement("div");
  root.id = "fs-how";
  root.innerHTML = `
    <div class="topnav">
      <a href="/">← BACK TO ARCADE</a>
      <a href="/contracts">📜 contracts</a>
      <a href="/leaderboard">📊 leaderboards</a>
    </div>
    <div class="inner">
      <h1>HOW IT WORKS</h1>
      <div class="lede">Every game on the arcade. End-to-end. Provable.</div>

      <div class="intro">
        You play in your browser like any other web game — no special hardware,
        no slow chain calls during play. When a run is worth keeping, the same
        deterministic sim that ran in your browser <strong>replays your exact
        inputs</strong> on the relay, producing a receipt: <em>this run was
        executed honestly and ended with this score.</em> The receipt lands on
        chain. The leaderboard you see isn't claimed — it's <strong>checked</strong>.
        Three different backends can produce that receipt (see "Behind the scenes" below).
      </div>

      <div class="sky">
        <span class="plane-fly"><span class="plane">✈️</span></span>
      </div>

      <div class="flow">
        <div class="step">
          ${ICON_PLAY}
          <h3>1 · PLAY</h3>
          <p>You play. Every input is recorded as you go.</p>
          <span class="tag">browser</span>
        </div>
        <div class="step">
          ${ICON_SIM}
          <h3>2 · SIM</h3>
          <p>A deterministic engine replays the run identically every time.</p>
          <span class="tag">fixed-point math</span>
        </div>
        <div class="step">
          ${ICON_STARK}
          <h3>3 · ZK PROOF</h3>
          <p>A zero-knowledge proof attests the run was executed honestly.</p>
          <span class="tag">STARK</span>
        </div>
        <div class="step">
          ${ICON_GROTH}
          <h3>4 · WRAP</h3>
          <p>The proof is compressed to a small on-chain-friendly blob.</p>
          <span class="tag">SNARK · 260 bytes</span>
        </div>
        <div class="step">
          ${ICON_CHAIN}
          <h3>5 · ON-CHAIN</h3>
          <p>A verifier contract checks the proof. Your score lands publicly.</p>
          <span class="tag">stellar soroban</span>
        </div>
      </div>

      <div class="backends">
        <div class="backends-head">
          <h2>BEHIND THE SCENES</h2>
          <div class="sub">The arcade can run the proving step in three different ways. Flip is one config; same contract serves all three.</div>
        </div>

        <details class="backend" open>
          <summary>
            <span class="left">
              <span class="caret">▼</span>
              <span class="label">🤝 ATTEST MODE</span>
            </span>
            <span class="tags">
              <span class="pill live">active</span>
              <span class="pill">~2s</span>
              <span class="pill">no per-proof cost</span>
            </span>
          </summary>
          <div class="body">
            <p>The relay re-runs your transcript through the same deterministic Rust simulation
            that a zero-knowledge prover would, computes the final score, and <strong>signs the
            result with a trusted operator key</strong>. The browser submits that signed
            payload via <code>settle_attested</code>. The contract verifies the signature
            against an on-chain operator address — no zero-knowledge proof, no marketplace.</p>
            <p><strong>Trust model:</strong> the relay is the oracle. The deterministic
            sim means a tampered browser can't fake a score (the relay independently
            recomputes from your raw inputs), but a malicious operator could in principle
            sign for a score that never happened. The operator key rotates via an admin
            call if ever compromised.</p>
            <p class="when">Best when speed matters more than cryptographic neutrality. Currently the default.</p>
          </div>
        </details>

        <details class="backend">
          <summary>
            <span class="left">
              <span class="caret">▶</span>
              <span class="label">🌐 BOUNDLESS MARKETPLACE</span>
            </span>
            <span class="tags">
              <span class="pill">5–25 min</span>
              <span class="pill">~$0.03–$0.07 / proof</span>
            </span>
          </summary>
          <div class="body">
            <p>The relay submits your transcript to a <strong>decentralized prover marketplace</strong>.
            An independent prover picks it up, runs the full RISC Zero STARK over your run,
            wraps it in a Groth16 SNARK, and returns a 260-byte seal. The browser submits via
            <code>submit_score</code>; the contract verifies the seal cryptographically.</p>
            <p><strong>Trust model:</strong> pure math. No party — relay, prover, or operator —
            can fake a score because the on-chain verifier checks the proof directly.</p>
            <p class="when">Best when ZK guarantees matter and a few-minute wait is acceptable. Pay per proof.</p>
          </div>
        </details>

        <details class="backend">
          <summary>
            <span class="left">
              <span class="caret">▶</span>
              <span class="label">🖥️ SELF-HOSTED VPS</span>
            </span>
            <span class="tags">
              <span class="pill">10–15 min</span>
              <span class="pill">VPS hosting</span>
            </span>
          </summary>
          <div class="body">
            <p>Same STARK + Groth16 pipeline as Boundless, but the prover runs <strong>directly on
            the relay's own VPS</strong> instead of a marketplace. The relay produces the same
            260-byte seal, the browser submits the same <code>submit_score</code> call, the
            contract verifies the same way.</p>
            <p><strong>Trust model:</strong> identical to Boundless — pure math via the on-chain
            verifier. You pay flat VPS hosting instead of per-proof fees.</p>
            <p class="when">Best when you want ZK guarantees, control over the prover stack, and predictable monthly cost.</p>
          </div>
        </details>
      </div>

      <div class="verdict">
        <div class="stamp">✓ SCORE VERIFIED</div>
      </div>

      <div class="outro">
        <strong>No fake scores. No bots posing as wins.</strong>
        Every leaderboard entry is a real playthrough whose execution can be
        re-verified by anyone, forever. The game is fun. The receipt is math.
        <div class="tech">zero-knowledge proofs · Stellar Soroban verifier · public, permissionless, unforgeable.</div>
      </div>

      <div class="cta">
        <a href="/">← back to arcade</a>
      </div>
    </div>
  `;
  document.body.appendChild(root);
}
