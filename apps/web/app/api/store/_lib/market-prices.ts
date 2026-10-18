import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRootFrom, StoreNotReady } from "./support";

// The store's own read-only view of the celebrity market's prices (market_celebrities.current_micros
// in data/amasa.db). The store imports nothing from the app; it only reads this one column.

let connection: { path: string; db: Database.Database } | undefined;

function db(): Database.Database {
  const path = process.env.DATABASE_PATH || join(repoRootFrom(), "data", "amasa.db");
  if (connection?.path === path && connection.db.open) return connection.db;
  if (!existsSync(path)) throw new StoreNotReady("The market database does not exist yet");
  connection = { path, db: new Database(path, { readonly: true, fileMustExist: true }) };
  return connection.db;
}

export function marketPrices(ids: readonly number[]): Map<number, number> {
  let rows: { id: number; current_micros: number }[];
  try {
    rows = db().prepare(`SELECT id, current_micros FROM market_celebrities WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { id: number; current_micros: number }[];
  } catch (error) {
    if (error instanceof StoreNotReady) throw error;
    throw new StoreNotReady("The market has not been seeded");
  }
  return new Map(rows.map((r) => [r.id, r.current_micros]));
}
