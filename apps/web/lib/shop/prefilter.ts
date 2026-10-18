import { priceLines, type Contract, type StoreListing } from "@amasa/schemas";
import { budgetRule, deadlineRule, mustHaveRule, returnWindowRule } from "@amasa/verifier";
import type { PricingConfig } from "@amasa/schemas";

// SPEC §7.4 step 5: deterministic prefilter with the verifier's own rule functions, on STORE fields
// only (never reader output). Each removed product is counted once, under the first rule it fails in
// this order, so the counts add up to the number of products removed.
export const PREFILTER_ORDER = ["MERCHANT_NOT_ALLOWED", "OUT_OF_STOCK", "MUST_HAVE_FAILED", "OVER_BUDGET",
  "RETURN_WINDOW_SHORT", "DEADLINE_MISSED"] as const;
export type PrefilterCode = (typeof PREFILTER_ORDER)[number];

export function estimateTotalCents(listing: StoreListing, qty: number, pricing: PricingConfig): number {
  return priceLines([{ unitCents: listing.unitCents, qty }], pricing).totalCents;
}

export function firstFailure(contract: Contract, listing: StoreListing, pricing: PricingConfig, now: number): PrefilterCode | null {
  if (!contract.allowedMerchants.includes(listing.merchant)) return "MERCHANT_NOT_ALLOWED";
  if (listing.stock < contract.quantity) return "OUT_OF_STOCK";
  if (mustHaveRule(contract, [listing.sku], { [listing.sku]: listing }).length) return "MUST_HAVE_FAILED";
  if (budgetRule(contract, estimateTotalCents(listing, contract.quantity, pricing)).length) return "OVER_BUDGET";
  if (returnWindowRule(contract, [listing]).length) return "RETURN_WINDOW_SHORT";
  if (deadlineRule(contract, [listing], now).length) return "DEADLINE_MISSED";
  return null;
}

export function prefilter<T extends { listing: StoreListing }>(
  contract: Contract, candidates: readonly T[], pricing: PricingConfig, now: number,
): { survivors: T[]; removed: { code: PrefilterCode; count: number }[] } {
  const counts = new Map<PrefilterCode, number>();
  const survivors: T[] = [];
  for (const candidate of candidates) {
    const code = firstFailure(contract, candidate.listing, pricing, now);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    else survivors.push(candidate);
  }
  return { survivors, removed: PREFILTER_ORDER.filter((code) => counts.has(code)).map((code) => ({ code, count: counts.get(code)! })) };
}
