import { z } from "zod";
import { Option, Sku } from "@amasa/schemas";
import type { Db } from "./index";

// The latest shopping run's options and flagged SKUs for a contract (written by /api/shop in M4).
const Options = z.array(Option).max(3);
const Flagged = z.array(Sku);

export function saveOptions(db: Db, contractId: string, options: Option[], flaggedSkus: string[], now: string): void {
  db.prepare(`INSERT INTO options (contract_id, json, flagged_json, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(contract_id) DO UPDATE SET json = excluded.json, flagged_json = excluded.flagged_json, created_at = excluded.created_at`)
    .run(contractId, JSON.stringify(Options.parse(options)), JSON.stringify(Flagged.parse(flaggedSkus)), now);
}

export function getOptions(db: Db, contractId: string): { options: Option[]; flaggedSkus: string[] } | null {
  const row = db.prepare("SELECT json, flagged_json FROM options WHERE contract_id = ?").get(contractId) as
    { json: string; flagged_json: string } | undefined;
  if (!row) return null;
  return { options: Options.parse(JSON.parse(row.json)), flaggedSkus: Flagged.parse(JSON.parse(row.flagged_json)) };
}
