import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProfileEntry, type AutonomyState, type Contract, type Purchase, type Rule } from "@amasa/schemas";
import { appendAudit } from "@amasa/audit";
import { onKept, onReturned, type ReturnReason } from "../autonomy";
import { getDb } from "../db";
import { getAutonomyState, recordAutonomyChange } from "../db/autonomy";
import { getContract } from "../db/contracts";
import { describeEntry, insertProfileEntry, listProfileEntries } from "../db/profile";
import { getPurchase, purchasesWithOutcome, setOutcomeReason, transitionPurchase } from "../db/purchases";
import { ApiError } from "../http";
import { isStoreRule } from "../store-attributes";

const Reason = z.enum(["not_as_described", "changed_mind", "other"]);
export const OutcomeBody = z.strictObject({
  purchaseNumber: z.string().regex(/^[A-Z0-9]{16}$/),
  outcome: z.enum(["kept", "returned"]),
  reason: Reason.optional(),
}).refine((body) => (body.outcome === "returned") === (body.reason !== undefined), { message: "A reason is required for a return, and only for a return." });

const REPEATS = 2;
const ruleId = (rule: Rule) => JSON.stringify([rule.key, rule.op, String(rule.value).toLowerCase()]);

type Candidate = Pick<ProfileEntry, "category" | "key" | "value" | "source" | "note">;

// SPEC §12 suggestion rules. Everything here comes from our own records (the confirmed contracts,
// the orders' outcomes and the store's structured name field), never from page text (I4). In the
// celebrity store a "brand" is the celebrity's name.
function suggestionsFor(contract: Contract, purchase: { brands: string[] }, outcome: "kept" | "returned", reason: ReturnReason | undefined,
  history: { kept: { brands: string[]; rules: Rule[] }[]; returned: { brands: string[]; outcomeReason: string | null }[] }): Candidate[] {
  const out: Candidate[] = [];
  if (outcome === "kept") {
    // A requirement the user kept asking for (e.g. genre includes pop) becomes a suggested preference.
    for (const rule of contract.mustHave.filter((r) => isStoreRule(contract.category, r))) {
      const times = history.kept.filter((p) => p.rules.some((r) => ruleId(r) === ruleId(rule))).length;
      const value = typeof rule.value === "string" ? rule.value.toLowerCase() : rule.value;
      if (times >= REPEATS) out.push({ category: contract.category, key: rule.key, value, source: "kept", note: `You kept ${times} orders with ${rule.key.replaceAll("_", " ")} ${value}` });
    }
  }
  for (const brand of purchase.brands) {
    if (outcome === "kept") {
      const times = history.kept.filter((p) => p.brands.includes(brand)).length;
      if (times >= REPEATS) out.push({ category: contract.category, key: "brand_like", value: brand, source: "kept", note: `You kept ${brand} ${times} times` });
    }
    if (outcome === "returned" && reason === "not_as_described") {
      const times = history.returned.filter((p) => p.outcomeReason === "not_as_described" && p.brands.includes(brand)).length;
      if (times >= REPEATS) out.push({ category: contract.category, key: "brand_avoid", value: brand, source: "returned", note: `You returned ${brand} as not as described ${times} times` });
    }
  }
  return out;
}

const sameValue = (a: string | number, b: string | number) => String(a).toLowerCase() === String(b).toLowerCase();

// POST /api/outcomes (SPEC §5, stage 9): Kept or Returned on an order that has a payment link. The
// outcome, the autonomy update, the suggestions, their audit rows and notices are one transaction.
export function recordOutcome(input: z.infer<typeof OutcomeBody>, now = new Date()): { purchase: Purchase; suggestions: ProfileEntry[]; autonomy: AutonomyState } {
  const parsed = OutcomeBody.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "Choose kept, or returned with a reason.");
  const { purchaseNumber, outcome, reason } = parsed.data;
  const db = getDb();
  const ts = now.toISOString();
  return db.transaction(() => {
    const record = getPurchase(db, purchaseNumber);
    if (!record) throw new ApiError(404, "PURCHASE_NOT_FOUND", "That order was not found.");
    if (!transitionPurchase(db, purchaseNumber, "link_created", outcome)) {
      throw new ApiError(409, "OUTCOME_NOT_ALLOWED", "Only an order with a payment link can be marked kept or returned, and only once.");
    }
    setOutcomeReason(db, purchaseNumber, reason ?? null);
    appendAudit(db, "outcome_recorded", { purchaseNumber, outcome, reason: reason ?? null }, ts);

    const before = getAutonomyState(db, record.purchase.category, ts);
    const autonomy = recordAutonomyChange(db, before, outcome === "kept" ? onKept(before, ts) : onReturned(before, reason!, ts), ts);

    const stored = getContract(db, record.purchase.contractId);
    const existing = listProfileEntries(db);
    const suggestions: ProfileEntry[] = [];
    if (stored) {
      const candidates = suggestionsFor(stored.contract, record, outcome, reason, {
        kept: purchasesWithOutcome(db, record.purchase.category, "kept")
          .map((p) => ({ brands: p.brands, rules: getContract(db, p.purchase.contractId)?.contract.mustHave ?? [] })),
        returned: purchasesWithOutcome(db, record.purchase.category, "returned"),
      });
      for (const candidate of candidates) {
        if ([...existing, ...suggestions].some((e) => e.category === candidate.category && e.key === candidate.key && sameValue(e.value, candidate.value))) continue;
        const entry = ProfileEntry.parse({ ...candidate, id: randomUUID(), status: "suggested", updatedAt: ts });
        const because = candidate.note.charAt(0).toLowerCase() + candidate.note.slice(1);
        insertProfileEntry(db, entry, `Amasa suggests ${describeEntry(entry)} because ${because}. Keep or forget it on your receipt or in Settings.`);
        suggestions.push(entry);
      }
    }
    return { purchase: getPurchase(db, purchaseNumber)!.purchase, suggestions, autonomy };
  }).immediate();
}
