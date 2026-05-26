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
  clearLatestTranscript,
  getLatestTranscript,
  onTranscriptChange,
} from "../chain/transcript-buffer.js";
import { connect, getAddress } from "../chain/wallet.js";

const STYLE = `
  #fs-submit-btn {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 90;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    font-size: 13px;
    padding: 10px 14px;
    background: #1f2a44;
    color: #fff;
    border: 1px solid #4a6da8;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  #fs-submit-btn:hover { background: #2c3b62; }
  #fs-submit-btn .badge {
    margin-left: 8px;
    background: #f5d04b;
    color: #20140a;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
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
    const transcript = getLatestTranscript();
    if (pending) {
      showButton("🏆 Sign Pending", `${ageMin(pending.proved_at)} min`);
    } else if (transcript) {
      showButton("🏆 Submit Score");
    } else {
      hideButton();
    }
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
        clearLatestTranscript();
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
          clearLatestTranscript();
          setStatus(
            `Score ${p.score} didn't beat your on-chain best — nothing to submit. Try a better run.`,
            "ok",
          );
          hideButton();
          renderAction();
          return;
        }
        setStatus(`Sign failed: ${m}`, "err");
      }
    }

    async function proveThenCache(transcript: Uint8Array, addr: string) {
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
      clearLatestTranscript();
      setStatus(`Proof built (score=${p.score}). Sign with your wallet to submit.`, "ok");
      renderAction();
    }

    function renderAction(): void {
      actionEl.innerHTML = "";
      const addr = getAddress();
      const pending = getPendingProof();
      const transcript = getLatestTranscript();

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

      if (transcript) {
        titleEl.textContent = "Submit your score on-chain";
        subEl.textContent = `${transcript.length} byte transcript · ${CONFIG.networkPassphrase.startsWith("Test") ? "testnet" : "mainnet"}`;
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
            await proveThenCache(transcript, addr);
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
  onTranscriptChange(refreshButtonVisibility);
  onPendingProofChange(refreshButtonVisibility);
  refreshButtonVisibility();
}
