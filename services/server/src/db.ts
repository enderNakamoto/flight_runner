// SQLite schema + thin helpers. Bun ships sqlite as a built-in; no
// extra deps.
//
// `runs` is the single source of truth: lifecycle is pending → proving →
// settled (or failed) on the proof_status column.

import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { CONFIG } from "./config.ts";

export type ProofStatus = "pending" | "proving" | "settled" | "failed";

export interface RunRow {
  id: number;
  player_strkey: string;
  player_pubkey_hex: string;
  transcript: Buffer;        // raw .bin contents
  proof_status: ProofStatus;
  seal_hex: string | null;
  journal_hex: string | null;
  tx_hash: string | null;
  error: string | null;
  created_at: number;        // unix ms
  updated_at: number;        // unix ms
}

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  mkdirSync(dirname(CONFIG.dbPath), { recursive: true });
  db = new Database(CONFIG.dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      player_strkey     TEXT    NOT NULL,
      player_pubkey_hex TEXT    NOT NULL,
      transcript        BLOB    NOT NULL,
      proof_status      TEXT    NOT NULL CHECK (proof_status IN ('pending','proving','settled','failed')),
      seal_hex          TEXT,
      journal_hex       TEXT,
      tx_hash           TEXT,
      error             TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (proof_status);
    CREATE INDEX IF NOT EXISTS idx_runs_player ON runs (player_strkey);
  `);
  return db;
}

export function now(): number { return Date.now(); }
