import { Verdict } from "@amasa/schemas";
import type { Cart, Contract, Quote, StoreListing } from "@amasa/schemas";
import {
  budgetRule, contractHashRule, currencyRule, deadlineRule, emptyCartRule, flaggedRule,
  merchantRule, mustHaveRule, quantityRule, quoteFreshRule, returnWindowRule, skuInQuoteRule,
  tapRule, weeklyCapRule, type Failure,
} from "./rules.ts";

// SPEC §9.1.
export interface VerifyInput {
  contract: Contract;
  storedContractHash: string;
  cart: Cart;
  quote: Quote | null;                         // fresh from §4.4
  listings: Record<string, StoreListing>;      // fresh from §4.3, keyed by sku
  flaggedSkus: ReadonlySet<string>;
  autonomy: { level: 0 | 1 | 2; weeklyCapCents: number; spentThisWeekCents: number };
  tap: { required: boolean; verified: boolean };
  now: number;                                 // epoch ms, passed in
}

// Evaluates every rule and collects all failures, except EMPTY_CART and SKU_NOT_IN_QUOTE,
// which stop evaluation (§9.2). Money checks use only the quote.
export function verify(input: VerifyInput): Verdict {
  const { contract, cart, quote, now } = input;
  const failures: Failure[] = [];
  const done = (): Verdict => Verdict.parse({
    pass: failures.length === 0,
    totalCents: quote?.totalCents ?? 0,
    failures,
  });

  failures.push(...contractHashRule(contract, input.storedContractHash, cart));

  const empty = emptyCartRule(cart);
  if (empty.length) { failures.push(...empty); return done(); }

  const missing = skuInQuoteRule(cart, quote);
  if (missing.length || quote === null) { failures.push(...missing); return done(); }

  const skus = cart.lines.map((l) => l.sku);
  failures.push(
    ...merchantRule(contract, [cart.merchant, quote.merchant]),
    ...tapRule(input.tap),
    ...quoteFreshRule(quote, now),
    ...currencyRule(quote),
    ...budgetRule(contract, quote.totalCents),
    ...mustHaveRule(contract, skus, input.listings),
    ...returnWindowRule(contract, quote.lines),
    ...deadlineRule(contract, quote.lines, now),
    ...quantityRule(contract, cart),
    ...flaggedRule(skus, input.flaggedSkus),
    ...weeklyCapRule(input.autonomy, quote.totalCents),
  );
  return done();
}
