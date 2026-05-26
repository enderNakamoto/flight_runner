// Submit UI — invisible until the player has either:
//   (a) a fresh transcript from the most recent game over, or
//   (b) a pending proof in localStorage waiting to be signed.
//
// Flow when the player engages:
//   1. Modal opens with whichever applies — a fresh transcript to prove,
//      or a pending proof to sign.
//   2. Prove path: POST transcript to relay (5–25 min). On success, the
//      proof is cached in localStorage and the modal switches to the
//      sign path. The player can close the tab and come back.
//   3. Sign path: connect wallet → wallet signs submit_score → tx lands.
//   4. On success, the pending proof + transcript buffer are cleared.

import { Buffer } from "buffer";
import { CONFIG } from "../chain/config.js";
import { getClient } from "../chain/game-hub.js";
import {
  clearPendingProof,
  getPendingProof,
  onPendingProofChange,
  setPendingProof,
  type PendingProof,
} from "../chain/pending-proof.js";
import { proveTranscript, type ProveResult } from "../chain/relay.js";
import {
  clearLatestRun,
  getLatestRun,
  onRunChange,
  type CapturedRun,
} from "../chain/transcript-buffer.js";
import { connect, getAddress } from "../chain/wallet.js";

// Slug → localStorage key used by that game's in-HUD BEST overlay.
// Mirror of the same map in chain/score-sync.ts. Used here to decide
// whether the just-played score is even worth offering to submit.
const BEST_STORAGE_KEYS: Record<string, string> = {
  birdstrike: "flight_scroll:best",
};

function localBestFor(slug: string): number {
  const key = BEST_STORAGE_KEYS[slug];
  if (!key) return 0;
  try {
    const raw = localStorage.getItem(key);
    return raw ? Number.parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function currentGameSlug(): string {
  return window.location.pathname.split("/").filter(Boolean)[0] ?? "";
}

const STYLE = `
  @keyframes fs-pulse {
    0%, 100% { box-shadow: 0 8px 24px rgba(124, 92, 240, 0.4), 0 0 0 0 rgba(245, 208, 75, 0.55); }
    50%      { box-shadow: 0 8px 24px rgba(124, 92, 240, 0.5), 0 0 0 14px rgba(245, 208, 75, 0); }
  }
  #fs-submit-btn {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    z-index: 90;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.3px;
    padding: 16px 32px;
    min-width: 280px;
    background: linear-gradient(135deg, #5b3aa8 0%, #2c5dd0 100%);
    color: #fff;
    border: 2px solid #8a6df0;
    border-radius: 10px;
    cursor: pointer;
    animation: fs-pulse 2.2s ease-in-out infinite;
    transition: transform 0.1s ease;
  }
  #fs-submit-btn:hover {
    background: linear-gradient(135deg, #6d4ac0 0%, #3a72e8 100%);
    transform: translateX(-50%) translateY(-1px);
  }
  #fs-submit-btn:active { transform: translateX(-50%) translateY(0); }
  #fs-submit-btn .badge {
    margin-left: 10px;
    background: #f5d04b;
    color: #20140a;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
    vertical-align: middle;
  }
  #fs-submit-modal {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    color: #eee;
  }
  #fs-submit-modal .card {
    background: #16223a;
    border: 1px solid #3a4a6b;
    border-radius: 8px;
    padding: 20px 24px;
    min-width: 360px;
    max-width: 520px;
    font-size: 13px;
  }
  #fs-submit-modal h2 {
    margin: 0 0 12px;
    font-size: 15px;
  }
  #fs-submit-modal .row { margin-top: 10px; }
  #fs-submit-modal button {
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    background: #2b3b5e;
    color: #fff;
    border: 1px solid #4a5d85;
    border-radius: 4px;
    padding: 6px 12px;
  }
  #fs-submit-modal button:hover:not(:disabled) { background: #3a4d75; }
  #fs-submit-modal button:disabled { opacity: 0.5; cursor: not-allowed; }
  #fs-submit-modal code {
    background: rgba(255,255,255,0.08);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: 11px;
  }
  #fs-submit-modal .err { color: #ff7a7a; }
  #fs-submit-modal .ok  { color: #7aff8e; }
  #fs-submit-modal .muted { color: #94a3c6; font-size: 11px; }
`;

function injectStyle(): void {
  if (document.getElementById("fs-submit-style")) return;
  const s = document.createElement("style");
  s.id = "fs-submit-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function fmtAddress(a: string): string {
  return a.length <= 14 ? a : `${a.slice(0, 8)}…${a.slice(-4)}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ageMin(ms: number): number {
  return Math.max(0, Math.round((Date.now() - ms) / 60000));
}

export function mountSubmitUI(): void {
  injectStyle();

  let btn: HTMLButtonElement | null = null;
  let modal: HTMLDivElement | null = null;

  function showButton(label: string, badge?: string) {
    if (btn) {
      btn.innerHTML = `${label}${badge ? `<span class="badge">${badge}</span>` : ""}`;
      return;
    }
    btn = document.createElement("button");
    btn.id = "fs-submit-btn";
    btn.innerHTML = `${label}${badge ? `<span class="badge">${badge}</span>` : ""}`;
    btn.onclick = openModal;
    document.body.appendChild(btn);
  }

  function hideButton() {
    btn?.remove();
    btn = null;
  }

  function refreshButtonVisibility() {
    if (modal) return; // don't fight the modal's open state
    const pending = getPendingProof();
    const run = getLatestRun();
    if (pending) {
      showButton("🏆 Sign Pending", `${ageMin(pending.proved_at)} min`);
      return;
    }
    if (run) {
      // Only offer to submit if the just-played score is at least equal
      // to the local best. localStorage best is hydrated from chain at
      // sign-in (see chain/score-sync.ts) so this compares against the
      // player's actual on-chain personal-best when signed in. Strictly
      // lower → no button, no wasted prove + tx.
      const localBest = localBestFor(currentGameSlug());
      if (run.score < localBest) {
        hideButton();
        return;
      }
      showButton("🏆 Submit Score");
      return;
    }
    hideButton();
  }

  function closeModal() {
    modal?.remove();
    modal = null;
    refreshButtonVisibility();
  }

  function openModal() {
    modal = document.createElement("div");
    modal.id = "fs-submit-modal";
    modal.innerHTML = `
      <div class="card">
        <h2 id="fs-modal-title">Submit your score on-chain</h2>
        <div class="muted" id="fs-modal-sub"></div>
        <div class="row" id="fs-modal-wallet"></div>
        <div class="row" id="fs-modal-action"></div>
        <div class="row" id="fs-modal-status"></div>
        <div class="row" style="margin-top:16px;">
          <button id="fs-modal-close">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const titleEl = modal.querySelector<HTMLElement>("#fs-modal-title")!;
    const subEl = modal.querySelector<HTMLElement>("#fs-modal-sub")!;
    const walletEl = modal.querySelector<HTMLDivElement>("#fs-modal-wallet")!;
    const actionEl = modal.querySelector<HTMLDivElement>("#fs-modal-action")!;
    const statusEl = modal.querySelector<HTMLDivElement>("#fs-modal-status")!;
    modal.querySelector<HTMLButtonElement>("#fs-modal-close")!.onclick = closeModal;

    function setStatus(text: string, cls?: "ok" | "err") {
      statusEl.textContent = text;
      statusEl.className = "row" + (cls ? ` ${cls}` : "");
    }

    function renderWalletRow(addr: string | null): void {
      walletEl.innerHTML = "";
      if (addr) {
        walletEl.innerHTML = `wallet: <code>${fmtAddress(addr)}</code>`;
        return;
      }
      const cb = document.createElement("button");
      cb.textContent = "Connect Wallet";
      cb.onclick = async () => {
        cb.disabled = true;
        setStatus("Opening wallet picker …");
        try {
          const a = await connect();
          setStatus(`Connected: ${fmtAddress(a)}`, "ok");
          renderWalletRow(a);
          renderAction();
        } catch (e) {
          setStatus(`Connect failed: ${errMsg(e)}`, "err");
          cb.disabled = false;
        }
      };
      walletEl.appendChild(cb);
    }

    async function signAndSubmit(p: PendingProof) {
      setStatus("Building tx and asking your wallet to sign …");
      try {
        const seal = Buffer.from(p.seal_hex, "hex");
        const journal = Buffer.from(p.journal_hex, "hex");
        const client = getClient();
        const tx = await client.submit_score({
          game_id: CONFIG.flightScrollGameId,
          seal,
          journal,
        });
        const { result } = await tx.signAndSend();
        (result as { unwrap: () => void }).unwrap();
        clearPendingProof();
        clearLatestRun();
        setStatus(`✅ Submitted. score=${p.score} ticks=${p.ticks_survived}`, "ok");
        hideButton();
        renderAction();
      } catch (e) {
        const m = errMsg(e);
        // Soroban marks submit_score as read-only when the new score
        // doesn't beat the existing PB (no HighScore write happens).
        // Bindings refuse to sign+send a no-op tx. That's the contract
        // working correctly — surface it nicely and drop the proof.
        if (/this is a read call/i.test(m)) {
          clearPendingProof();
          clearLatestRun();
          setStatus(
            `Score ${p.score} didn't beat your on-chain best — nothing to submit. Try a better run.`,
            "ok",
          );
          hideButton();
          renderAction();
          return;
        }
        // Wallet account isn't funded / doesn't exist on the network.
        if (
          /account not found/i.test(m) ||
          /could not load account/i.test(m) ||
          /resource[_\s]?not[_\s]?found/i.test(m) ||
          /404/i.test(m)
        ) {
          setStatus(
            `Your wallet has no XLM on this network. Fund it via friendbot (testnet) or by buying XLM (mainnet), then retry.`,
            "err",
          );
          return;
        }
        // Account exists but balance too low for fees.
        if (
          /insufficient[_\s]?balance/i.test(m) ||
          /insufficient[_\s]?fee/i.test(m) ||
          /tx_insufficient/i.test(m)
        ) {
          setStatus(
            `Wallet balance too low to pay tx fees. Top up your XLM and retry.`,
            "err",
          );
          return;
        }
        // Player declined / closed the wallet popup.
        if (
          /user (?:declined|rejected|denied|cancel)/i.test(m) ||
          /user reject/i.test(m) ||
          /denied transaction signature/i.test(m)
        ) {
          setStatus("Wallet signature cancelled. Click Sign again when ready.", "err");
          return;
        }
        setStatus(`Sign failed: ${m}`, "err");
      }
    }

    async function proveThenCache(run: CapturedRun, addr: string) {
      const transcript = run.bytes;
      setStatus("Proving on the relay (this takes a few minutes) …");
      const r: ProveResult = await proveTranscript(addr, transcript);
      if (!r.ok) {
        setStatus(`Prove failed: ${r.error}`, "err");
        return;
      }
      const p: PendingProof = {
        player_strkey: addr,
        seal_hex: r.seal_hex,
        journal_hex: r.journal_hex,
        score: r.score ?? 0,
        ticks_survived: r.ticks_survived ?? 0,
        proved_at: Date.now(),
      };
      setPendingProof(p);
      clearLatestRun();
      setStatus(`Proof built (score=${p.score}). Sign with your wallet to submit.`, "ok");
      renderAction();
    }

    function renderAction(): void {
      actionEl.innerHTML = "";
      const addr = getAddress();
      const pending = getPendingProof();
      const run = getLatestRun();

      if (pending) {
        titleEl.textContent = pending.player_strkey === addr
          ? "Sign your pending submission"
          : "Pending proof — switch wallets to sign";
        subEl.textContent = `score=${pending.score} · ticks=${pending.ticks_survived} · cached ${ageMin(pending.proved_at)} min ago`;

        if (!addr) {
          // connect wallet first; renderWalletRow handles that branch
          return;
        }
        if (pending.player_strkey !== addr) {
          actionEl.innerHTML = `<span class="err">connected wallet doesn't match the pending proof's player (${fmtAddress(pending.player_strkey)}). Switch wallets or discard the proof.</span>`;
          const drop = document.createElement("button");
          drop.textContent = "Discard pending proof";
          drop.style.marginTop = "6px";
          drop.onclick = () => {
            clearPendingProof();
            renderAction();
            refreshButtonVisibility();
          };
          actionEl.appendChild(drop);
          return;
        }
        const sign = document.createElement("button");
        sign.textContent = "Sign + Submit to chain";
        sign.onclick = () => signAndSubmit(pending);
        actionEl.appendChild(sign);
        const drop = document.createElement("button");
        drop.textContent = "Discard";
        drop.style.marginLeft = "6px";
        drop.onclick = () => {
          clearPendingProof();
          renderAction();
          refreshButtonVisibility();
        };
        actionEl.appendChild(drop);
        return;
      }

      if (run) {
        titleEl.textContent = "Submit your score on-chain";
        subEl.textContent = `score ${run.score} · ticks ${run.ticks} · ${CONFIG.networkPassphrase.startsWith("Test") ? "testnet" : "mainnet"}`;
        if (!CONFIG.relayUrl) {
          actionEl.innerHTML = `<span class="err">VITE_RELAY_URL not set — proving unavailable.</span>`;
          return;
        }
        if (!addr) return;
        const proveBtn = document.createElement("button");
        proveBtn.textContent = "Prove this run";
        proveBtn.onclick = async () => {
          proveBtn.disabled = true;
          try {
            await proveThenCache(run, addr);
          } finally {
            proveBtn.disabled = false;
          }
        };
        actionEl.appendChild(proveBtn);
        return;
      }

      titleEl.textContent = "Nothing to submit";
      subEl.textContent = "Play a run, then come back here.";
    }

    renderWalletRow(getAddress());
    renderAction();
  }

  // Show/hide the floating button when either source of work changes.
  onRunChange(refreshButtonVisibility);
  onPendingProofChange(refreshButtonVisibility);
  refreshButtonVisibility();
}
