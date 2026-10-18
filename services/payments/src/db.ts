import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

// SPEC §14: the payments service's own database. Statuses: reserved, link_created, failed, rejected.

function repoRoot(): string {
  let dir = resolve(__dirname);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("Could not find the repo root (pnpm-workspace.yaml)");
    dir = up;
  }
  return dir;
}

export function defaultDbPath(): string {
  return process.env.PAYMENTS_DB_PATH || join(repoRoot(), "data", "payments.db");
}

export function openPaymentsDb(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS payments (
    purchase_number TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL
  )`);
  return db;
}
