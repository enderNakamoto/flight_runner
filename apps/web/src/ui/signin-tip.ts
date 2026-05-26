// Pre-play sign-in nudge — small unobtrusive tip shown on the game page
// before the player has connected a wallet AND before they've finished
// a run. Auto-hides as soon as either flips:
//   - wallet connects (no longer needs the nudge)
//   - transcript appears (submit-ui takes over with its CTA)
//
// "Sign in to track your score · or skip and sign in later." — easy
// to ignore, easy to engage with.

import { connect, getAddress, onWalletChange } from "../chain/wallet.js";
import { getLatestRun, onRunChange } from "../chain/transcript-buffer.js";

const STYLE = `
  #fs-signin-tip {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 80;
    background: rgba(20, 24, 40, 0.85);
    border: 1px dashed rgba(245, 208, 75, 0.35);
    border-radius: 4px;
    color: #d8e0f0;
    padding: 8px 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #fs-signin-tip button {
    background: transparent;
    color: #f5d04b;
    border: 1px solid #6b4a08;
    border-radius: 3px;
    padding: 3px 8px;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  #fs-signin-tip button:hover { background: rgba(245, 208, 75, 0.1); }
  #fs-signin-tip .skip {
    color: #94a3c6;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
  }
  #fs-signin-tip .skip:hover { color: #fff; }
`;

function injectStyle(): void {
  if (document.getElementById("fs-signin-tip-style")) return;
  const s = document.createElement("style");
  s.id = "fs-signin-tip-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

export function mountSigninTip(): void {
  injectStyle();
  let tip: HTMLElement | null = null;
  let dismissed = false;

  function show() {
    if (tip) return;
    tip = document.createElement("div");
    tip.id = "fs-signin-tip";
    tip.innerHTML = `
      <span>💡 sign in to track your scores</span>
      <button id="fs-signin-tip-go">SIGN IN</button>
      <span class="skip" id="fs-signin-tip-skip">skip</span>
    `;
    document.body.appendChild(tip);
    tip.querySelector<HTMLButtonElement>("#fs-signin-tip-go")!.onclick = async () => {
      try {
        await connect();
        // onWalletChange will hide the tip.
      } catch {
        // user cancelled — leave the tip up
      }
    };
    tip.querySelector<HTMLElement>("#fs-signin-tip-skip")!.onclick = () => {
      dismissed = true;
      hide();
    };
  }

  function hide() {
    tip?.remove();
    tip = null;
  }

  function refresh() {
    if (dismissed) return hide();
    if (getAddress()) return hide();              // signed in already
    if (getLatestRun()) return hide();           // round finished, submit-ui takes over
    show();
  }

  onWalletChange(refresh);
  onRunChange(refresh);
  refresh();
}
