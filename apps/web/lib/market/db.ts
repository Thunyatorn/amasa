import { getDb, openDb, type Db } from "../db/index.ts";
import { migrateMarket } from "./migrations.ts";

export function openMarketDb(path: string): Db {
  const db = openDb(path);
  try { migrateMarket(db); return db; } catch (error) { db.close(); throw error; }
}
export function getMarketDb(): Db {
  const db = getDb();
  migrateMarket(db);
  return db;
}
