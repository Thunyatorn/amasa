import { Contract } from "@amasa/schemas";
import type { Db } from "./index";

export function insertContract(db: Db, contract: Contract, hash: string, now: string): void {
  db.prepare("INSERT INTO contracts (id, json, hash, created_at) VALUES (?, ?, ?, ?)")
    .run(contract.id, JSON.stringify(contract), hash, now);
}

export function getContract(db: Db, id: string): { contract: Contract; contractHash: string } | null {
  const row = db.prepare("SELECT json, hash FROM contracts WHERE id = ?").get(id) as { json: string; hash: string } | undefined;
  if (!row) return null;
  return { contract: Contract.parse(JSON.parse(row.json)), contractHash: row.hash };
}
