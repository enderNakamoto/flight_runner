// Wallet panel — DOM-based overlay outside Phaser.
//
// Simplified Phase 5 flow:
//   1. Player connects wallet (optional — game playable without).
//   2. Player plays the game locally; transcript saved via T key.
//   3. Player runs `./scripts/prove.sh transcript.bin --player <strkey>` locally.
//   4. Player uploads proof_artifacts.json → wallet signs submit_score.
//   5. Personal best updates only if the new score beats the existing one.

import { Buffer } from "buffer";
import { StrKey } from "@stellar/stellar-sdk";
import type { HighScoreEntry } from "@flight/game-hub-client";
import { CONFIG } from "../chain/config.js";
import { getClient, getReadClient } from "../chain/game-hub.js";
import { connect, disconnect, getAddress, onWalletChange } from "../chain/wallet.js";

function fmtAddress(a: string): string {
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

/// Decode a Stellar G… strkey to its raw 32-byte ED25519 pubkey.
function strkeyToPubkey(strkey: string): Buffer {
  return Buffer.from(StrKey.decodeEd25519PublicKey(strkey));
}

interface ProofArtifacts {
  mode?: string;
  seal: string;
  journal: string;
  image_id?: string;
  output?: {
    score?: number;
    ticks_survived?: number;
    seed?: number;
    player?: string;
    player_pubkey?: string;
  };
}

function parseArtifacts(text: string): ProofArtifacts {
  const j = JSON.parse(text);
  if (typeof j.seal !== "string" || typeof j.journal !== "string") {
    throw new Error("proof_artifacts.json: missing seal/journal");
  }
  return j as ProofArtifacts;
}

export function mountWalletPanel(root: HTMLElement): void {
  root.innerHTML = `
    <div><strong>game_hub</strong> · testnet</div>
    <div class="row">contract: <code id="cp-contract"></code></div>
    <div class="row" id="cp-wallet-row"></div>
    <div class="row" id="cp-best"></div>
    <div class="row" id="cp-submit"></div>
    <div class="row" id="cp-msg"></div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    root.querySelector(sel) as T;

  $<HTMLElement>("#cp-contract").textContent = CONFIG.gameHubContractId
    ? fmtAddress(CONFIG.gameHubContractId)
    : "(unset — deploy in slice 6)";

  const walletRow = $<HTMLDivElement>("#cp-wallet-row");
  const bestRow = $<HTMLDivElement>("#cp-best");
  const submitRow = $<HTMLDivElement>("#cp-submit");
  const msgEl = $<HTMLDivElement>("#cp-msg");

  function setMsg(text: string, cls?: "ok" | "err") {
    msgEl.textContent = text;
    msgEl.className = "row" + (cls ? ` ${cls}` : "");
  }

  // ── Submit Score ──────────────────────────────────────────────────────

  function renderSubmit(addr: string | null) {
    submitRow.innerHTML = "";
    if (!addr || !CONFIG.gameHubContractId) return;

    const cmd = `./scripts/prove.sh transcript.bin --player ${addr}`;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div style="color:#9bb; font-size:10px;">
        after playing: <code>${cmd}</code><br>
        then upload <code>proof_artifacts.json</code>:
      </div>
    `;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.style.fontSize = "10px";
    fileInput.style.marginTop = "4px";
    fileInput.style.display = "block";

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Submit Score";
    submitBtn.disabled = true;
    fileInput.onchange = () => {
      submitBtn.disabled = !fileInput.files || fileInput.files.length === 0;
    };

    submitBtn.onclick = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      submitBtn.disabled = true;
      setMsg("Parsing proof_artifacts.json …");
      try {
        const text = await file.text();
        const a = parseArtifacts(text);
        const seal = hexToBuffer(a.seal);
        const journal = hexToBuffer(a.journal);
        if (seal.length !== 260) throw new Error(`seal must be 260 bytes, got ${seal.length}`);
        if (journal.length !== 76) throw new Error(`journal must be 76 bytes, got ${journal.length}`);

        // Sanity: journal[12..44] is the player pubkey. It must match
        // the connected wallet — otherwise this proof credits a different
        // address and the user has no business signing it.
        const journalPubkey = journal.subarray(12, 44).toString("hex");
        const walletPubkey = strkeyToPubkey(addr).toString("hex");
        if (journalPubkey !== walletPubkey) {
          throw new Error(
            `proof commits to a different player (${journalPubkey.slice(0, 8)}…) ` +
              `than the connected wallet (${walletPubkey.slice(0, 8)}…). ` +
              `Re-run prove.sh with --player ${addr}.`,
          );
        }

        const client = getClient();
        setMsg("Signing submit_score …");
        const tx = await client.submit_score({
          game_id: CONFIG.flightScrollGameId,
          seal,
          journal,
        });
        setMsg("Submitting tx …");
        const { result } = await tx.signAndSend();
        (result as { unwrap: () => void }).unwrap();
        const sc = a.output?.score ?? "?";
        const t = a.output?.ticks_survived ?? "?";
        setMsg(`Submitted! score=${sc} ticks=${t}`, "ok");
        refreshBest(addr).catch(() => {});
      } catch (e) {
        setMsg(`submit_score failed: ${errMsg(e)}`, "err");
        submitBtn.disabled = !fileInput.files || fileInput.files.length === 0;
      }
    };

    wrap.appendChild(fileInput);
    wrap.appendChild(submitBtn);
    submitRow.appendChild(wrap);
  }

  // ── My Best ───────────────────────────────────────────────────────────

  function renderBestRow(entry: HighScoreEntry | null) {
    bestRow.innerHTML = "";
    const label = document.createElement("span");
    if (entry) {
      label.innerHTML =
        `best: <code>${entry.score}</code> · ticks <code>${entry.ticks_survived}</code> ` +
        `· seed <code>0x${(entry.seed >>> 0).toString(16).padStart(8, "0")}</code>`;
    } else {
      label.innerHTML = `best: <em>none yet</em>`;
    }
    const btn = document.createElement("button");
    btn.textContent = "Refresh";
    btn.style.marginLeft = "6px";
    const addr = getAddress();
    btn.disabled = !addr || !CONFIG.gameHubContractId;
    btn.onclick = () => {
      if (!addr) return;
      refreshBest(addr).catch((e) => setMsg(`get_score failed: ${errMsg(e)}`, "err"));
    };
    bestRow.appendChild(label);
    bestRow.appendChild(btn);
  }

  async function refreshBest(addr: string): Promise<void> {
    const client = getReadClient();
    const res = await client.get_score({
      game_id: CONFIG.flightScrollGameId,
      player_pubkey: strkeyToPubkey(addr),
    });
    const entry = (res.result as HighScoreEntry | undefined) ?? null;
    renderBestRow(entry);
  }

  // ── Wallet row ────────────────────────────────────────────────────────

  function renderWalletRow(addr: string | null) {
    if (addr) {
      walletRow.innerHTML = `wallet: <code>${fmtAddress(addr)}</code> `;
      const dc = document.createElement("button");
      dc.textContent = "Disconnect";
      dc.onclick = () => {
        disconnect();
        setMsg("Disconnected.");
      };
      walletRow.appendChild(dc);
    } else {
      walletRow.innerHTML = ``;
      const btn = document.createElement("button");
      btn.textContent = "Connect Wallet";
      btn.onclick = async () => {
        btn.disabled = true;
        setMsg("Opening wallet picker …");
        try {
          const a = await connect();
          setMsg(`Connected: ${fmtAddress(a)}`, "ok");
          refreshBest(a).catch(() => {});
        } catch (e) {
          setMsg(`Connect failed: ${errMsg(e)}`, "err");
          btn.disabled = false;
        }
      };
      walletRow.appendChild(btn);
    }
    renderSubmit(addr);
    renderBestRow(null);
  }

  onWalletChange(renderWalletRow);
  renderWalletRow(getAddress());
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
