import { sha256 } from "@amasa/schemas";
import type { AttrValue, Cart, Contract, FailureCode, Quote, Rule, StoreListing } from "@amasa/schemas";

// SPEC §9.2. Pure rule functions: no network, no model, no clock reads (`now` is passed in).
// Each returns the failures it finds; an empty array means the rule passed.
// These same functions back the shopping-run prefilter (§7.4 step 5).

export interface Failure { code: FailureCode; detail: string }

const DAY_MS = 86_400_000;
export const QUOTE_MAX_AGE_MS = 5 * 60_000;

const fail = (code: FailureCode, detail: string): Failure[] => [{ code, detail: detail.slice(0, 200) }];

export function contractHashRule(contract: Contract, storedContractHash: string, cart: Cart): Failure[] {
  if (sha256(contract) !== storedContractHash) {
    return fail("CONTRACT_HASH_MISMATCH", "The contract changed after it was confirmed.");
  }
  if (cart.contractHash !== storedContractHash) {
    return fail("CONTRACT_HASH_MISMATCH", "The cart was built for a different version of the contract.");
  }
  return [];
}

export function emptyCartRule(cart: Cart): Failure[] {
  return cart.lines.length === 0 ? fail("EMPTY_CART", "The cart has no items.") : [];
}

const qtyBySku = (lines: ReadonlyArray<{ sku: string; qty: number }>) => {
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.sku, (m.get(l.sku) ?? 0) + l.qty);
  return m;
};

// Cart and quote must hold exactly the same SKUs and quantities. A quote line that is not in the
// cart also fails: otherwise the quoted total would include items nobody chose.
export function skuInQuoteRule(cart: Cart, quote: Quote | null): Failure[] {
  if (quote === null) return fail("SKU_NOT_IN_QUOTE", "The store did not return a quote.");
  const cartQty = qtyBySku(cart.lines);
  const quoteQty = qtyBySku(quote.lines);
  for (const [sku, qty] of cartQty) {
    const q = quoteQty.get(sku);
    if (q === undefined) return fail("SKU_NOT_IN_QUOTE", `${sku} is missing from the store quote.`);
    if (q !== qty) return fail("SKU_NOT_IN_QUOTE", `${sku}: the quote has quantity ${q}, the cart has ${qty}.`);
  }
  for (const sku of quoteQty.keys()) {
    if (!cartQty.has(sku)) return fail("SKU_NOT_IN_QUOTE", `${sku} is in the store quote but not in the cart.`);
  }
  return [];
}

export function merchantRule(contract: Contract, merchants: readonly string[]): Failure[] {
  const bad = [...new Set(merchants)].filter((m) => !contract.allowedMerchants.includes(m));
  return bad.length ? fail("MERCHANT_NOT_ALLOWED", `Merchant not allowed by the contract: ${bad.join(", ")}.`) : [];
}

export function tapRule(tap: { required: boolean; verified: boolean }): Failure[] {
  return tap.required && !tap.verified ? fail("TAP_FAILED", "The agent signature check did not pass.") : [];
}

export function quoteFreshRule(quote: Quote, now: number): Failure[] {
  return now - quote.quotedAt > QUOTE_MAX_AGE_MS
    ? fail("QUOTE_STALE", "The store quote is more than 5 minutes old.")
    : [];
}

export function currencyRule(quote: Quote): Failure[] {
  const currency: string = quote.currency;
  return currency !== "USD" ? fail("CURRENCY_MISMATCH", `The quote is in ${currency}, not USD.`) : [];
}

export function budgetRule(contract: Contract, totalCents: number): Failure[] {
  return totalCents > contract.budgetCapCents
    ? fail("OVER_BUDGET", `Total ${totalCents} cents is over the budget of ${contract.budgetCapCents} cents.`)
    : [];
}

// Must-have operators (§9.2): eq (numbers equal; strings equal ignoring case), gte/lte (numbers
// only), includes (attribute string contains the value ignoring case; for comma-separated
// attributes, a whole item must match). A missing attribute fails.
export function ruleHolds(rule: Rule, attr: AttrValue | undefined): boolean {
  if (attr === undefined) return false;
  const v = rule.value;
  switch (rule.op) {
    case "eq":
      if (typeof attr === "number" && typeof v === "number") return attr === v;
      if (typeof attr === "string" && typeof v === "string") return attr.toLowerCase() === v.toLowerCase();
      return false;
    case "gte":
      return typeof attr === "number" && typeof v === "number" && attr >= v;
    case "lte":
      return typeof attr === "number" && typeof v === "number" && attr <= v;
    case "includes": {
      if (typeof attr !== "string") return false;
      const needle = String(v).trim().toLowerCase();
      if (needle === "") return false;
      const hay = attr.toLowerCase();
      if (hay.includes(",")) return hay.split(",").some((item) => item.trim() === needle);
      return hay.includes(needle);
    }
  }
}

const describeRule = (r: Rule) => `${r.key} ${r.op} ${JSON.stringify(r.value)}`;

export function mustHaveRule(
  contract: Contract,
  skus: readonly string[],
  listings: Readonly<Record<string, StoreListing>>,
): Failure[] {
  const out: Failure[] = [];
  for (const sku of new Set(skus)) {
    const listing = listings[sku];
    if (!listing) {
      out.push(...fail("MUST_HAVE_FAILED", `${sku}: no store listing to check the must-haves against.`));
      continue;
    }
    for (const rule of contract.mustHave) {
      if (!ruleHolds(rule, listing.attributes[rule.key])) {
        out.push(...fail("MUST_HAVE_FAILED", `${sku} fails ${describeRule(rule)}.`));
      }
    }
  }
  return out;
}

export function returnWindowRule(contract: Contract, lines: ReadonlyArray<{ sku: string; returnDays: number }>): Failure[] {
  const short = lines.filter((l) => l.returnDays < contract.minReturnDays);
  return short.length
    ? fail("RETURN_WINDOW_SHORT", short.map((l) =>
        `${l.sku} allows ${l.returnDays}-day returns; the contract needs ${contract.minReturnDays}.`).join(" "))
    : [];
}

// Fails when now + the slowest line's delivery days lands on a UTC date after the deadline.
// Arriving on the deadline date itself passes.
export function deadlineRule(contract: Contract, lines: ReadonlyArray<{ deliveryDays: number }>, now: number): Failure[] {
  if (contract.deadline === undefined || lines.length === 0) return [];
  const maxDays = Math.max(...lines.map((l) => l.deliveryDays));
  const arrival = new Date(now + maxDays * DAY_MS).toISOString().slice(0, 10);
  return arrival > contract.deadline
    ? fail("DEADLINE_MISSED", `Delivery would arrive ${arrival}, after the deadline ${contract.deadline}.`)
    : [];
}

export function quantityRule(contract: Contract, cart: Cart): Failure[] {
  const total = cart.lines.reduce((sum, l) => sum + l.qty, 0);
  return total !== contract.quantity
    ? fail("QUANTITY_MISMATCH", `The cart has ${total} items; the contract asks for ${contract.quantity}.`)
    : [];
}

export function flaggedRule(skus: readonly string[], flaggedSkus: ReadonlySet<string>): Failure[] {
  const bad = [...new Set(skus)].filter((s) => flaggedSkus.has(s));
  return bad.length ? fail("FLAGGED_LISTING", `Flagged listing in the cart: ${bad.join(", ")}.`) : [];
}

export function weeklyCapRule(
  autonomy: { level: 0 | 1 | 2; weeklyCapCents: number; spentThisWeekCents: number },
  totalCents: number,
): Failure[] {
  if (autonomy.level !== 2) return [];
  return autonomy.spentThisWeekCents + totalCents > autonomy.weeklyCapCents
    ? fail("WEEKLY_CAP_EXCEEDED",
        `This order would bring this week's spend to ${autonomy.spentThisWeekCents + totalCents} cents; the weekly cap is ${autonomy.weeklyCapCents}.`)
    : [];
}
