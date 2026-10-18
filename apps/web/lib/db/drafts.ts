import { ContractDraft, Rule } from "@amasa/schemas";
import { z } from "zod";
import type { Db } from "./index.ts";

const Unsupported = z.array(Rule).max(8);
export type DraftRecord = { draft: ContractDraft; unsupported: Rule[] };

export function insertDraft(db: Db, id: string, draft: ContractDraft, now: string, unsupported: Rule[] = []): void {
  db.prepare("INSERT INTO contract_drafts (id, json, created_at, unsupported_json) VALUES (?, ?, ?, ?)")
    .run(id, JSON.stringify(ContractDraft.parse(draft)), now, JSON.stringify(Unsupported.parse(unsupported)));
}

export function getDraftRecord(db: Db, id: string): DraftRecord | null {
  const row = db.prepare("SELECT json, unsupported_json FROM contract_drafts WHERE id = ?").get(id) as
    { json: string; unsupported_json: string } | undefined;
  if (!row) return null;
  return { draft: ContractDraft.parse(JSON.parse(row.json)), unsupported: Unsupported.parse(JSON.parse(row.unsupported_json)) };
}

export function getDraft(db: Db, id: string): ContractDraft | null {
  return getDraftRecord(db, id)?.draft ?? null;
}

export function deleteDraft(db: Db, id: string): void {
  db.prepare("DELETE FROM contract_drafts WHERE id = ?").run(id);
}
