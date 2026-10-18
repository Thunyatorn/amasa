import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Contract, ContractDraft, sha256 } from "@amasa/schemas";
import { appendAudit } from "@amasa/audit";
import { getDb } from "../db";
import { insertContract } from "../db/contracts";
import { ApiError } from "../http";
import { KNOWN_MERCHANTS } from "../merchants";

export const ConfirmBody = z.strictObject({ draft: ContractDraft });

// POST /api/contracts: the user confirms an edited draft. Assigns id + confirmedAt, stores the
// contract and its hash, and writes audit contract_confirmed (SPEC §2.2, §5).
export function confirmContract(draft: ContractDraft): { contract: Contract; contractHash: string } {
  if (draft.question !== null) throw new ApiError(400, "DRAFT_HAS_QUESTION", "Answer the open question before confirming.");
  if (draft.budgetCapCents === null) throw new ApiError(400, "BUDGET_REQUIRED", "Set a budget before confirming.");
  const unknown = draft.allowedMerchants.filter((m) => !(KNOWN_MERCHANTS as readonly string[]).includes(m));
  if (unknown.length) throw new ApiError(400, "UNKNOWN_MERCHANT", "The contract lists a store Amasa does not shop.");

  const { question: _question, ...rest } = draft;
  const now = new Date().toISOString();
  const contract = Contract.parse({ ...rest, budgetCapCents: draft.budgetCapCents, id: randomUUID(), confirmedAt: now });
  const contractHash = sha256(contract);
  const db = getDb();
  db.transaction(() => {
    insertContract(db, contract, contractHash, now);
    appendAudit(db, "contract_confirmed", { contractId: contract.id, contractHash }, now);
  }).immediate();
  return { contract, contractHash };
}
