// index-leaderboard.ts — paginated top-N indexer for game_hub.
//
// Walks the on-chain enumeration table for one game, fetches each
// player's current PB, sorts by (score desc, ticks asc), and writes a
// static JSON snapshot the frontend can fetch.
//
// Usage:
//   npx tsx scripts/index-leaderboard.ts                    # uses .deploy-state.testnet
//   GAME_HUB_ID=C... RPC_URL=... npx tsx scripts/index-leaderboard.ts
//   npx tsx scripts/index-leaderboard.ts --game 1 --slug birdstrike --top 200
//
// Output:
//   public/leaderboard/<slug>.json
//
// This script makes ~ (N / PAGE_SIZE) + N RPC calls — 30 + 1500 = 1530
// at the full cap. We batch get_score calls in groups of 20 to keep
// wall time reasonable; the public Soroban RPC has been fine with this.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { Client, type HighScoreEntry } from "@flight/game-hub-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ── Arguments / config ─────────────────────────────────────────────────────
interface Args {
  gameId: number;
  slug: string;
  top: number;
  contractId: string;
  rpcUrl: string;
  passphrase: string;
}

function parseArgs(): Args {
  // 1. Defaults from .deploy-state.testnet if present.
  let contractId = process.env.GAME_HUB_ID ?? "";
  let rpcUrl = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
  let passphrase = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;

  const stateFile = join(REPO_ROOT, ".deploy-state.testnet");
  if (!contractId && existsSync(stateFile)) {
    const raw = readFileSync(stateFile, "utf8");
    const m = raw.match(/^GAME_HUB_ID=(\S+)$/m);
    if (m) contractId = m[1]!;
  }

  // 2. CLI flag overrides.
  let gameId = 1;
  let slug = "birdstrike";
  let top = 100;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const val = argv[i + 1];
    if (flag === "--game" && val) { gameId = parseInt(val, 10); i++; }
    else if (flag === "--slug" && val) { slug = val; i++; }
    else if (flag === "--top" && val) { top = parseInt(val, 10); i++; }
    else if (flag === "--contract" && val) { contractId = val; i++; }
    else if (flag === "--rpc" && val) { rpcUrl = val; i++; }
  }

  if (!contractId) {
    throw new Error(
      "no contract id — set GAME_HUB_ID env or pass --contract <C...>, " +
      "or run scripts/deploy.sh first to produce .deploy-state.testnet",
    );
  }
  return { gameId, slug, top, contractId, rpcUrl, passphrase };
}

// ── Indexer ───────────────────────────────────────────────────────────────
async function fetchAllPubkeys(client: Client, gameId: number): Promise<Buffer[]> {
  const countRes = await client.get_player_count({ game_id: gameId });
  const count = countRes.result as number;
  console.log(`  player_count: ${count}`);
  if (count === 0) return [];

  // Page size must match the contract's MAX_PAGE_SIZE (50).
  const PAGE = 50;
  const out: Buffer[] = [];
  for (let start = 0; start < count; start += PAGE) {
    const end = Math.min(start + PAGE, count);
    const pageRes = await client.get_players_page({
      game_id: gameId,
      start,
      end,
    });
    const page = pageRes.result as Buffer[];
    out.push(...page);
    console.log(`  page [${start}, ${end}): ${page.length} pubkeys`);
  }
  return out;
}

interface ScoreRow {
  pubkey: Buffer;
  entry: HighScoreEntry;
}

async function fetchAllScores(
  client: Client,
  gameId: number,
  pubkeys: Buffer[],
): Promise<ScoreRow[]> {
  const BATCH = 20;
  const rows: ScoreRow[] = [];
  for (let i = 0; i < pubkeys.length; i += BATCH) {
    const chunk = pubkeys.slice(i, i + BATCH);
    const settled = await Promise.all(
      chunk.map((pk) =>
        client.get_score({ game_id: gameId, player_pubkey: pk }).then(
          (r) => [pk, r.result as HighScoreEntry | undefined] as const,
        ),
      ),
    );
    for (const [pk, entry] of settled) {
      if (entry) rows.push({ pubkey: pk, entry });
    }
    console.log(`  scores [${i}, ${i + chunk.length}): ${rows.length} cumulative`);
  }
  return rows;
}

function rank(rows: ScoreRow[]): ScoreRow[] {
  return [...rows].sort((a, b) => {
    if (a.entry.score !== b.entry.score) return b.entry.score - a.entry.score;
    return a.entry.ticks_survived - b.entry.ticks_survived; // fewer ticks for same score = better efficiency
  });
}

// ── Output ─────────────────────────────────────────────────────────────────
interface SnapshotEntry {
  rank: number;
  address: string;     // G-strkey form, for display
  pubkey_hex: string;  // raw bytes, for re-querying via SDK
  score: number;
  ticks_survived: number;
  seed: number;
  settled_at: number;  // unix seconds
}

interface Snapshot {
  game_id: number;
  slug: string;
  contract_id: string;
  generated_at: string;       // ISO 8601
  generated_at_unix: number;
  player_count: number;       // distinct enumerated players
  top_n: number;
  entries: SnapshotEntry[];
}

function buildSnapshot(args: Args, rows: ScoreRow[]): Snapshot {
  const sorted = rank(rows).slice(0, args.top);
  return {
    game_id: args.gameId,
    slug: args.slug,
    contract_id: args.contractId,
    generated_at: new Date().toISOString(),
    generated_at_unix: Math.floor(Date.now() / 1000),
    player_count: rows.length,
    top_n: args.top,
    entries: sorted.map((row, i) => ({
      rank: i + 1,
      address: StrKey.encodeEd25519PublicKey(row.pubkey),
      pubkey_hex: row.pubkey.toString("hex"),
      score: row.entry.score,
      ticks_survived: row.entry.ticks_survived,
      seed: row.entry.seed,
      settled_at: Number(row.entry.settled_at),
    })),
  };
}

function writeSnapshot(slug: string, snap: Snapshot): string {
  const outDir = join(REPO_ROOT, "public", "leaderboard");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${slug}.json`);
  writeFileSync(outPath, JSON.stringify(snap, null, 2) + "\n");
  return outPath;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[index-leaderboard] game_id=${args.gameId} slug=${args.slug} top=${args.top}`);
  console.log(`[index-leaderboard] contract=${args.contractId}`);
  console.log(`[index-leaderboard] rpc=${args.rpcUrl}`);

  const client = new Client({
    contractId: args.contractId,
    networkPassphrase: args.passphrase,
    rpcUrl: args.rpcUrl,
    publicKey: undefined,
  });

  const t0 = Date.now();
  console.log(`[index-leaderboard] fetching player enumeration …`);
  const pubkeys = await fetchAllPubkeys(client, args.gameId);

  console.log(`[index-leaderboard] fetching ${pubkeys.length} scores in batches of 20 …`);
  const rows = await fetchAllScores(client, args.gameId, pubkeys);

  const snap = buildSnapshot(args, rows);
  const outPath = writeSnapshot(args.slug, snap);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[index-leaderboard] ✅ ${rows.length} entries · top-${snap.entries.length}`);
  console.log(`[index-leaderboard]    wrote ${outPath} in ${dt}s`);
}

main().catch((e) => {
  console.error(`[index-leaderboard] ❌`, e instanceof Error ? e.message : e);
  process.exit(1);
});
