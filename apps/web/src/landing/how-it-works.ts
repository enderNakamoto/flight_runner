// /how-it-works — illustrated explainer of the play → proof → chain
// pipeline. Pixel-art house style, SVG stick figures + CSS animation.
// No external assets so the page boots fast and works offline.

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
    padding: 32px 24px 96px;
  }
  #fs-how h1 {
    font-family: var(--font-pixel);
    font-size: 28px;
    text-align: center;
    margin: 0 0 14px;
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
    margin: 0 0 48px;
  }

  /* Animated banner — a stick pilot's paper plane tracks across the top
     of the flow, looping forever. */
  #fs-how .sky {
    position: relative;
    height: 60px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  #fs-how .sky .plane {
    position: absolute;
    top: 8px;
    left: 0;
    font-size: 26px;
    animation: fs-fly 9s linear infinite;
  }
  @keyframes fs-fly {
    0%   { transform: translateX(-40px) translateY(0); }
    25%  { transform: translateX(25vw) translateY(-6px); }
    50%  { transform: translateX(50vw) translateY(0); }
    75%  { transform: translateX(75vw) translateY(-6px); }
    100% { transform: translateX(calc(100vw + 40px)) translateY(0); }
  }

  /* Flow strip: 5 steps + arrows between them */
  #fs-how .flow {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    align-items: stretch;
  }
  #fs-how .step {
    background: var(--bg-card);
    border: 3px solid var(--border);
    box-shadow: 4px 4px 0 var(--border);
    padding: 16px 12px;
    text-align: center;
    position: relative;
  }
  #fs-how .step .icon {
    width: 56px;
    height: 56px;
    margin: 0 auto 10px;
    display: block;
  }
  #fs-how .step h3 {
    font-family: var(--font-pixel);
    font-size: 11px;
    color: var(--accent);
    margin: 0 0 8px;
    letter-spacing: 0.5px;
    line-height: 1.3;
  }
  #fs-how .step p {
    font-size: 12px;
    line-height: 1.5;
    color: #d0d8ee;
    margin: 0;
  }
  #fs-how .step .tag {
    font-family: var(--font-pixel);
    font-size: 8px;
    color: var(--muted);
    display: block;
    margin-top: 8px;
  }

  /* Pulsing arrow between cards */
  #fs-how .flow .step:not(:last-child)::after {
    content: '▶';
    position: absolute;
    right: -14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--accent);
    font-size: 14px;
    z-index: 1;
    animation: fs-pulse-arrow 1.6s ease-in-out infinite;
  }
  @keyframes fs-pulse-arrow {
    0%, 100% { opacity: 0.4; transform: translateY(-50%) translateX(0); }
    50%      { opacity: 1;   transform: translateY(-50%) translateX(3px); }
  }

  /* "Verified" stamp under the chain */
  #fs-how .verdict {
    margin-top: 36px;
    text-align: center;
  }
  #fs-how .verdict .stamp {
    display: inline-block;
    padding: 16px 28px;
    border: 3px dashed #7aff8e;
    color: #7aff8e;
    font-family: var(--font-pixel);
    font-size: 14px;
    letter-spacing: 1px;
    transform: rotate(-3deg);
    border-radius: 6px;
  }
  #fs-how .verdict p {
    color: var(--muted);
    font-size: 13px;
    margin: 16px 0 0;
  }

  /* CTA buttons at the very bottom */
  #fs-how .cta {
    margin-top: 56px;
    text-align: center;
    display: flex;
    gap: 14px;
    justify-content: center;
    flex-wrap: wrap;
  }
  #fs-how .cta a {
    font-family: var(--font-pixel);
    font-size: 12px;
    padding: 12px 22px;
    text-decoration: none;
    border-radius: 8px;
    letter-spacing: 0.5px;
  }
  #fs-how .cta a.primary {
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border: 2px solid #8a6df0;
  }
  #fs-how .cta a.primary:hover {
    background: linear-gradient(135deg, #6d4ac0 0%, #3a72e8 100%);
  }
  #fs-how .cta a.ghost {
    background: transparent;
    color: var(--muted);
    border: 2px solid var(--border);
  }
  #fs-how .cta a.ghost:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  @media (max-width: 760px) {
    #fs-how .flow {
      grid-template-columns: 1fr;
    }
    #fs-how .flow .step:not(:last-child)::after {
      content: '▼';
      right: 50%;
      top: auto;
      bottom: -14px;
      transform: translateX(50%);
      animation: fs-pulse-arrow-v 1.6s ease-in-out infinite;
    }
    @keyframes fs-pulse-arrow-v {
      0%, 100% { opacity: 0.4; transform: translateX(50%) translateY(0); }
      50%      { opacity: 1;   transform: translateX(50%) translateY(3px); }
    }
    #fs-how h1 { font-size: 22px; }
  }
`;

// SVG icons — chunky stick-figure / blocky style. Each fits in 56×56.
const STICK_PLAY = `
  <svg class="icon" viewBox="0 0 56 56" fill="none" stroke="#f5d04b" stroke-width="2.5" stroke-linecap="square">
    <circle cx="28" cy="14" r="5"/>
    <line x1="28" y1="19" x2="28" y2="36"/>
    <line x1="28" y1="24" x2="18" y2="30"/>
    <line x1="28" y1="24" x2="38" y2="30"/>
    <line x1="28" y1="36" x2="22" y2="48"/>
    <line x1="28" y1="36" x2="34" y2="48"/>
    <rect x="36" y="26" width="14" height="8" fill="#5b3aa8" stroke="#8a6df0"/>
  </svg>
`;
const STICK_SIM = `
  <svg class="icon" viewBox="0 0 56 56" fill="none" stroke="#7aff8e" stroke-width="2.5" stroke-linecap="square">
    <rect x="8" y="14" width="40" height="28"/>
    <line x1="14" y1="22" x2="42" y2="22"/>
    <line x1="14" y1="28" x2="36" y2="28"/>
    <line x1="14" y1="34" x2="42" y2="34"/>
    <line x1="14" y1="40" x2="28" y2="40"/>
  </svg>
`;
const STICK_STARK = `
  <svg class="icon" viewBox="0 0 56 56" fill="none" stroke="#9be7ff" stroke-width="2.5" stroke-linecap="square">
    <rect x="10" y="6" width="36" height="44" fill="rgba(155,231,255,0.08)"/>
    <line x1="16" y1="16" x2="40" y2="16"/>
    <line x1="16" y1="22" x2="40" y2="22"/>
    <line x1="16" y1="28" x2="32" y2="28"/>
    <line x1="16" y1="34" x2="40" y2="34"/>
    <line x1="16" y1="40" x2="28" y2="40"/>
  </svg>
`;
const STICK_GROTH = `
  <svg class="icon" viewBox="0 0 56 56" fill="none" stroke="#f5d04b" stroke-width="2.5" stroke-linecap="square">
    <rect x="14" y="14" width="28" height="28" fill="rgba(245,208,75,0.1)"/>
    <line x1="20" y1="14" x2="20" y2="42"/>
    <line x1="36" y1="14" x2="36" y2="42"/>
    <line x1="14" y1="20" x2="42" y2="20"/>
    <line x1="14" y1="36" x2="42" y2="36"/>
    <circle cx="28" cy="28" r="4" fill="#f5d04b" stroke="none"/>
  </svg>
`;
const STICK_CHAIN = `
  <svg class="icon" viewBox="0 0 56 56" fill="none" stroke="#ff79c6" stroke-width="2.5" stroke-linecap="square">
    <rect x="6" y="22" width="14" height="14"/>
    <rect x="22" y="22" width="14" height="14"/>
    <rect x="38" y="22" width="12" height="14"/>
    <line x1="20" y1="29" x2="22" y2="29"/>
    <line x1="36" y1="29" x2="38" y2="29"/>
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
      <a href="/leaderboard">📊 leaderboards</a>
    </div>
    <div class="inner">
      <h1>HOW IT WORKS</h1>
      <div class="lede">Your run, end-to-end — from joystick to leaderboard.</div>

      <div class="sky"><span class="plane">✈️</span></div>

      <div class="flow">
        <div class="step">
          ${STICK_PLAY}
          <h3>1 · PLAY</h3>
          <p>Steer your plane through the gauntlet. Every input is recorded.</p>
          <span class="tag">↑/↓/←/→</span>
        </div>
        <div class="step">
          ${STICK_SIM}
          <h3>2 · SIM</h3>
          <p>A deterministic sim plays your run back the same way every time.</p>
          <span class="tag">Q24.8 fixed-point</span>
        </div>
        <div class="step">
          ${STICK_STARK}
          <h3>3 · STARK PROOF</h3>
          <p>A zero-knowledge proof shows the run was executed honestly.</p>
          <span class="tag">RISC Zero</span>
        </div>
        <div class="step">
          ${STICK_GROTH}
          <h3>4 · GROTH16 WRAP</h3>
          <p>Compressed into a small on-chain-friendly proof, 260 bytes.</p>
          <span class="tag">BN254 SNARK</span>
        </div>
        <div class="step">
          ${STICK_CHAIN}
          <h3>5 · ON-CHAIN</h3>
          <p>Verifier contract checks the proof on Stellar Soroban.</p>
          <span class="tag">game_hub</span>
        </div>
      </div>

      <div class="verdict">
        <div class="stamp">✓ SCORE VERIFIED</div>
        <p>Recorded on chain, unforgeable. Your high score is real.</p>
      </div>

      <div class="cta">
        <a class="primary" href="/birdstrike">▶ PLAY BIRDSTRIKE</a>
        <a class="ghost" href="/">← back to arcade</a>
      </div>
    </div>
  `;
  document.body.appendChild(root);
}
