import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { migrateAudit } from "@amasa/audit";
import { databasePath } from "../env";

// SPEC §14: data/amasa.db (better-sqlite3, WAL). Additions to §14, documented in the README:
// carts.quote_json, purchases.failure_codes, the options table, and contract_drafts (M3).

export type Db = Database.Database;

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contract_drafts (
      id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL,
      unsupported_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY, json TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, json TEXT NOT NULL,
      signed_fields TEXT, signature TEXT, approval_nonce TEXT, nonce_used INTEGER NOT NULL DEFAULT 0,
      quote_json TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases (
      purchase_number TEXT PRIMARY KEY, cart_id TEXT NOT NULL, contract_id TEXT NOT NULL,
      category TEXT NOT NULL, status TEXT NOT NULL, total_cents INTEGER NOT NULL,
      payment_link_url TEXT, failure_codes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS options (
      contract_id TEXT PRIMARY KEY, json TEXT NOT NULL, flagged_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_entries (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS autonomy (category TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  // Databases created before unsupported_json existed get the column added in place.
  const draftColumns = db.prepare("PRAGMA table_info(contract_drafts)").all() as { name: string }[];
  if (!draftColumns.some((column) => column.name === "unsupported_json")) {
    db.exec("ALTER TABLE contract_drafts ADD COLUMN unsupported_json TEXT NOT NULL DEFAULT '[]'");
  }
  migrateAudit(db);
}

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

// One connection per process; cached on globalThis so Next's dev reloads don't open new ones.
const g = globalThis as unknown as { __amasaDb?: Db };
export function getDb(): Db {
  g.__amasaDb ??= openDb(databasePath());
  return g.__amasaDb;
}
