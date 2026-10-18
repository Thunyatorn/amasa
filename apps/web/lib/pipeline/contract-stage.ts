import { z } from "zod";
import { Contract, ContractDraft, sha256 } from "@amasa/schemas";
import { appendAudit } from "@amasa/audit";
import { getDb } from "../db";
import { getDraftRecord, deleteDraft } from "../db/drafts";
import { insertContract } from "../db/contracts";
import { ApiError } from "../http";
import { KNOWN_MERCHANTS } from "../merchants";
import { isStoreRule } from "../store-attributes";

// acknowledgedUnsupported: the user saw and removed every requirement intake found that the store
// cannot check. Required whenever the stored draft has any (SPEC §5, M3).
export const ConfirmBody = z.strictObject({
  draftId: z.string().uuid(), draft: ContractDraft, acknowledgedUnsupported: z.literal(true).optional(),
});

// POST /api/contracts: the user confirms an edited draft. Assigns id + confirmedAt, stores the
// contract and its hash, and writes audit contract_confirmed (SPEC §2.2, §5).
export function confirmContract(input: z.infer<typeof ConfirmBody>): { contract: Contract; contractHash: string } {
  const parsed = ConfirmBody.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "The draft confirmation has invalid values.");
  const { draftId, draft, acknowledgedUnsupported } = parsed.data;
  if (draft.question !== null) throw new ApiError(400, "DRAFT_HAS_QUESTION", "Answer the open question before confirming.");
  if (draft.budgetCapCents === null) throw new ApiError(400, "BUDGET_REQUIRED", "Set a budget before confirming.");
  const unknown = draft.allowedMerchants.filter((m) => !(KNOWN_MERCHANTS as readonly string[]).includes(m));
  if (unknown.length) throw new ApiError(400, "UNKNOWN_MERCHANT", "The contract lists a store Amasa does not shop.");
  // A rule on an attribute the store does not have could never pass the verifier.
  if (draft.mustHave.some((rule) => !isStoreRule(draft.category, rule))) {
    throw new ApiError(400, "UNSUPPORTED_RULE", "One requirement can't be checked at the store. Remove it and try again.");
  }

  const { question: _question, ...rest } = draft;
  const now = new Date().toISOString();
  const contract = Contract.parse({ ...rest, budgetCapCents: draft.budgetCapCents, id: draftId, confirmedAt: now });
  const contractHash = sha256(contract);
  const db = getDb();
  db.transaction(() => {
    const stored = getDraftRecord(db, draftId);
    if (!stored) throw new ApiError(409, "DRAFT_CONSUMED", "This draft is no longer available to confirm.");
    if (stored.unsupported.length && !acknowledgedUnsupported) {
      throw new ApiError(400, "UNSUPPORTED_NOT_REVIEWED", "Review the requirements Amasa can't check before confirming.");
    }
    deleteDraft(db, draftId);
    insertContract(db, contract, contractHash, now);
    appendAudit(db, "contract_confirmed", { contractId: contract.id, contractHash }, now);
  }).immediate();
  return { contract, contractHash };
}
