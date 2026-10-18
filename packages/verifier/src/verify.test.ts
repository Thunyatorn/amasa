import { describe, expect, it } from "vitest";
import { priceLines, sha256, type Cart, type Contract, type FailureCode, type Quote, type StoreListing } from "@amasa/schemas";
import { verify, type VerifyInput } from "./verify.ts";
import { ruleHolds } from "./rules.ts";

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0); // 2026-10-17T12:00:00Z
const PRICING = { taxRateBps: 800, freeShippingOverCents: 10000, flatShippingCents: 599 };

const baseContract: Contract = {
  id: "11111111-1111-4111-8111-111111111111",
  category: "actors",
  goal: "wide running shoes for a half marathon, size 10.5, under $140",
  quantity: 1,
  budgetCapCents: 14000,
  mustHave: [
    { key: "width", op: "eq", value: "wide" },
    { key: "sizes_available", op: "includes", value: "10.5" },
  ],
  allowedMerchants: ["demo-store"],
  minReturnDays: 14,
  confirmedAt: "2026-10-17T11:00:00.000Z",
};

const listing = (over: Partial<StoreListing> = {}): StoreListing => ({
  merchant: "demo-store",
  sku: "SHOE-WIDE-01",
  title: "Wide Road Runner",
  brand: "Stride",
  category: "actors",
  unitCents: 12900,
  returnDays: 30,
  deliveryDays: 3,
  stock: 5,
  rating: 4.5,
  reviewCount: 120,
  sponsored: false,
  attributes: { width: "wide", sizes_available: "9,9.5,10,10.5,11", use: "road" },
  ...over,
});

// Quote priced with the real §4.1 rules unless a total is forced.
function quoteFor(lines: Array<{ l: StoreListing; qty: number }>, over: Partial<Quote> = {}): Quote {
  const p = priceLines(lines.map(({ l, qty }) => ({ unitCents: l.unitCents, qty })), PRICING);
  return {
    quoteId: "q-1",
    merchant: "demo-store",
    currency: "USD",
    lines: lines.map(({ l, qty }) => ({
      sku: l.sku, title: l.title, qty, unitCents: l.unitCents, lineCents: l.unitCents * qty,
      returnDays: l.returnDays, deliveryDays: l.deliveryDays,
    })),
    ...p,
    quotedAt: NOW - 60_000,
    ...over,
  };
}

function input(over: {
  contract?: Partial<Contract>;
  listing?: Partial<StoreListing>;
  qty?: number;
  quote?: Partial<Quote> | null;
  cart?: Partial<Cart>;
  autonomy?: VerifyInput["autonomy"];
  tap?: VerifyInput["tap"];
  flagged?: string[];
  now?: number;
} = {}): VerifyInput {
  const contract = { ...baseContract, ...over.contract };
  const storedContractHash = sha256(contract);
  const l = listing(over.listing);
  const qty = over.qty ?? 1;
  const cart: Cart = {
    id: "22222222-2222-4222-8222-222222222222",
    contractId: contract.id,
    contractHash: storedContractHash,
    merchant: "demo-store",
    lines: [{ sku: l.sku, qty }],
    ...over.cart,
  };
  return {
    contract,
    storedContractHash,
    cart,
    quote: over.quote === null ? null : quoteFor([{ l, qty }], over.quote ?? {}),
    listings: { [l.sku]: l },
    flaggedSkus: new Set(over.flagged ?? []),
    autonomy: over.autonomy ?? { level: 0, weeklyCapCents: 0, spentThisWeekCents: 0 },
    tap: over.tap ?? { required: false, verified: false },
    now: over.now ?? NOW,
  };
}

const codes = (i: VerifyInput): FailureCode[] => verify(i).failures.map((f) => f.code);

describe("verify: baseline", () => {
  it("the SHOE-WIDE-01 demo order passes with total $139.32", () => {
    const v = verify(input());
    expect(v).toEqual({ pass: true, totalCents: 13932, failures: [] });
  });
});

// One test per row of SPEC §9.3.
describe("verify: SPEC §9.3 required cases", () => {
  it("total exactly at cap: pass", () => {
    const v = verify(input({ quote: { totalCents: 14000 } }));
    expect(v.pass).toBe(true);
  });

  it("total 1 cent over cap: OVER_BUDGET", () => {
    expect(codes(input({ quote: { totalCents: 14001 } }))).toEqual(["OVER_BUDGET"]);
  });

  it("unit price under cap, tax + shipping push it over: OVER_BUDGET", () => {
    // $135.00 item: tax $10.80 -> total $145.80, over $140.00
    const i = input({ listing: { unitCents: 13500 } });
    expect(i.quote!.totalCents).toBe(14580);
    expect(codes(i)).toEqual(["OVER_BUDGET"]);
  });

  it("return window 1 day below minimum: RETURN_WINDOW_SHORT", () => {
    expect(codes(input({ listing: { returnDays: 13 } }))).toEqual(["RETURN_WINDOW_SHORT"]);
  });

  it("merchant not allowed: MERCHANT_NOT_ALLOWED", () => {
    expect(codes(input({ contract: { allowedMerchants: ["other-store"] } }))).toEqual(["MERCHANT_NOT_ALLOWED"]);
  });

  it("TAP required and not verified: TAP_FAILED", () => {
    expect(codes(input({ tap: { required: true, verified: false } }))).toEqual(["TAP_FAILED"]);
  });

  it("missing must-have attribute: MUST_HAVE_FAILED", () => {
    const i = input({ listing: { attributes: { sizes_available: "9,10,10.5,11" } } }); // no width
    expect(codes(i)).toEqual(["MUST_HAVE_FAILED"]);
    expect(verify(i).failures[0]!.detail).toContain('width eq "wide"');
  });

  it("gte rule with a string attribute: MUST_HAVE_FAILED", () => {
    const i = input({
      contract: { mustHave: [{ key: "rating_count", op: "gte", value: 10 }] },
      listing: { attributes: { rating_count: "100" } },
    });
    expect(codes(i)).toEqual(["MUST_HAVE_FAILED"]);
  });

  it('includes "10.5" against "9,10,10.5,11": pass', () => {
    const i = input({
      contract: { mustHave: [{ key: "sizes_available", op: "includes", value: "10.5" }] },
      listing: { attributes: { sizes_available: "9,10,10.5,11" } },
    });
    expect(verify(i).pass).toBe(true);
  });

  it('includes "0.5" against "9,10,10.5,11": MUST_HAVE_FAILED (whole-item match)', () => {
    const i = input({
      contract: { mustHave: [{ key: "sizes_available", op: "includes", value: "0.5" }] },
      listing: { attributes: { sizes_available: "9,10,10.5,11" } },
    });
    expect(codes(i)).toEqual(["MUST_HAVE_FAILED"]);
  });

  it("contract edited after the cart was built: CONTRACT_HASH_MISMATCH", () => {
    const i = input();
    // The user raises the budget after the cart was built; the stored hash and cart hash are stale.
    i.contract = { ...i.contract, budgetCapCents: 20000 };
    expect(codes(i)).toEqual(["CONTRACT_HASH_MISMATCH"]);
  });

  it("quantity 2 when the contract says 1: QUANTITY_MISMATCH", () => {
    const i = input({ qty: 2, listing: { unitCents: 5000 } }); // 2 x $50 stays under budget
    expect(codes(i)).toEqual(["QUANTITY_MISMATCH"]);
  });

  it("quote 5 min + 1 ms old: QUOTE_STALE", () => {
    expect(codes(input({ quote: { quotedAt: NOW - 5 * 60_000 - 1 } }))).toEqual(["QUOTE_STALE"]);
  });

  it("delivery lands one day after the deadline: DEADLINE_MISSED", () => {
    // now 2026-10-17 + 3 days = 2026-10-20; deadline the day before
    expect(codes(input({ contract: { deadline: "2026-10-19" } }))).toEqual(["DEADLINE_MISSED"]);
  });

  it("flagged SKU in cart: FLAGGED_LISTING", () => {
    expect(codes(input({ flagged: ["SHOE-WIDE-01"] }))).toEqual(["FLAGGED_LISTING"]);
  });

  it("level 2, weekly cap exceeded by 1 cent: WEEKLY_CAP_EXCEEDED", () => {
    const i = input({ autonomy: { level: 2, weeklyCapCents: 15000, spentThisWeekCents: 15000 - 13932 + 1 } });
    expect(codes(i)).toEqual(["WEEKLY_CAP_EXCEEDED"]);
  });

  it("level 1, same totals: no WEEKLY_CAP_EXCEEDED", () => {
    const i = input({ autonomy: { level: 1, weeklyCapCents: 15000, spentThisWeekCents: 15000 - 13932 + 1 } });
    expect(verify(i).pass).toBe(true);
  });

  it("cart SKU missing from quote: SKU_NOT_IN_QUOTE", () => {
    const i = input({ cart: { lines: [{ sku: "SHOE-WIDE-02", qty: 1 }] } });
    expect(codes(i)).toEqual(["SKU_NOT_IN_QUOTE"]);
  });

  it("several failures at once: all codes listed", () => {
    const i = input({
      listing: { unitCents: 18900, returnDays: 7, attributes: { width: "standard", sizes_available: "10.5" } },
      contract: { allowedMerchants: ["other-store"], deadline: "2026-10-18" },
      quote: { quotedAt: NOW - 10 * 60_000 },
      flagged: ["SHOE-WIDE-01"],
      tap: { required: true, verified: false },
    });
    expect(codes(i).sort()).toEqual([
      "DEADLINE_MISSED", "FLAGGED_LISTING", "MERCHANT_NOT_ALLOWED", "MUST_HAVE_FAILED",
      "OVER_BUDGET", "QUOTE_STALE", "RETURN_WINDOW_SHORT", "TAP_FAILED",
    ]);
  });
});

// CLAUDE.md: every rule has at least one passing and one failing test. Failing cases are above
// (plus the ones below); these are the boundary passes and the remaining rules.
describe("verify: per-rule boundaries", () => {
  it("CONTRACT_HASH_MISMATCH: cart built from a different contract hash fails, matching hash passes", () => {
    expect(codes(input({ cart: { contractHash: "0".repeat(64) } }))).toEqual(["CONTRACT_HASH_MISMATCH"]);
    expect(verify(input()).pass).toBe(true);
  });

  it("EMPTY_CART stops evaluation", () => {
    const i = input({ cart: { lines: [] }, flagged: ["SHOE-WIDE-01"] });
    expect(codes(i)).toEqual(["EMPTY_CART"]);
  });

  it("SKU_NOT_IN_QUOTE: null quote fails and stops; totalCents is 0", () => {
    const v = verify(input({ quote: null, tap: { required: true, verified: false } }));
    expect(v.failures.map((f) => f.code)).toEqual(["SKU_NOT_IN_QUOTE"]);
    expect(v.totalCents).toBe(0);
  });

  it("SKU_NOT_IN_QUOTE: quantity differs from the quote", () => {
    const i = input();
    i.cart = { ...i.cart, lines: [{ sku: "SHOE-WIDE-01", qty: 2 }] };
    expect(codes(i)).toEqual(["SKU_NOT_IN_QUOTE"]);
  });

  it("SKU_NOT_IN_QUOTE: an extra quote line that is not in the cart fails", () => {
    const i = input();
    const extra = { ...i.quote!.lines[0]!, sku: "SOCK-12" };
    i.quote = { ...i.quote!, lines: [...i.quote!.lines, extra] };
    expect(codes(i)).toEqual(["SKU_NOT_IN_QUOTE"]);
  });

  it("MERCHANT_NOT_ALLOWED: quote from a different merchant fails", () => {
    expect(codes(input({ quote: { merchant: "evil-store" } }))).toEqual(["MERCHANT_NOT_ALLOWED"]);
  });

  it("TAP_FAILED: required and verified passes", () => {
    expect(verify(input({ tap: { required: true, verified: true } })).pass).toBe(true);
  });

  it("QUOTE_STALE: exactly 5 minutes old passes", () => {
    expect(verify(input({ quote: { quotedAt: NOW - 5 * 60_000 } })).pass).toBe(true);
  });

  it("CURRENCY_MISMATCH: a non-USD quote fails, USD passes", () => {
    const i = input();
    i.quote = { ...i.quote!, currency: "EUR" as "USD" };
    expect(codes(i)).toEqual(["CURRENCY_MISMATCH"]);
    expect(verify(input()).pass).toBe(true);
  });

  it("MUST_HAVE_FAILED: no listing for a cart SKU fails", () => {
    const i = input();
    i.listings = {};
    expect(codes(i)).toEqual(["MUST_HAVE_FAILED"]);
  });

  it("RETURN_WINDOW_SHORT: exactly the minimum passes", () => {
    expect(verify(input({ listing: { returnDays: 14 } })).pass).toBe(true);
  });

  it("DEADLINE_MISSED: arriving on the deadline date passes; no deadline passes", () => {
    expect(verify(input({ contract: { deadline: "2026-10-20" } })).pass).toBe(true);
    expect(verify(input()).pass).toBe(true);
  });

  it("QUANTITY_MISMATCH: matching quantity passes", () => {
    expect(verify(input({ qty: 2, listing: { unitCents: 5000 }, contract: { quantity: 2 } })).pass).toBe(true);
  });

  it("FLAGGED_LISTING: a flagged SKU not in the cart passes", () => {
    expect(verify(input({ flagged: ["SHOE-LUX-01"] })).pass).toBe(true);
  });

  it("WEEKLY_CAP_EXCEEDED: level 2 exactly at the cap passes", () => {
    const i = input({ autonomy: { level: 2, weeklyCapCents: 15000, spentThisWeekCents: 15000 - 13932 } });
    expect(verify(i).pass).toBe(true);
  });

  it("failure details are at most 200 characters", () => {
    const longSku = "A".repeat(24);
    const i = input({ listing: { sku: longSku, attributes: {} } });
    i.contract.mustHave = Array.from({ length: 8 }, (_, n) => ({ key: "k".repeat(24), op: "eq" as const, value: "x".repeat(40) + n }));
    i.storedContractHash = sha256(i.contract);
    i.cart.contractHash = i.storedContractHash;
    for (const f of verify(i).failures) expect(f.detail.length).toBeLessThanOrEqual(200);
  });
});

describe("must-have operators", () => {
  it("eq: numbers equal, strings ignore case, mixed types fail", () => {
    expect(ruleHolds({ key: "width", op: "eq", value: "WIDE" }, "wide")).toBe(true);
    expect(ruleHolds({ key: "size", op: "eq", value: 10.5 }, 10.5)).toBe(true);
    expect(ruleHolds({ key: "size", op: "eq", value: 10.5 }, "10.5")).toBe(false);
  });
  it("gte/lte: numbers only", () => {
    expect(ruleHolds({ key: "n", op: "gte", value: 10 }, 10)).toBe(true);
    expect(ruleHolds({ key: "n", op: "gte", value: 10 }, 9)).toBe(false);
    expect(ruleHolds({ key: "n", op: "lte", value: 10 }, 10)).toBe(true);
    expect(ruleHolds({ key: "n", op: "lte", value: 10 }, 11)).toBe(false);
    expect(ruleHolds({ key: "n", op: "lte", value: "10" }, 5)).toBe(false);
  });
  it("includes: substring for plain strings, whole item for comma lists, case-insensitive", () => {
    expect(ruleHolds({ key: "diet", op: "includes", value: "Gluten" }, "gluten free")).toBe(true);
    expect(ruleHolds({ key: "sizes_available", op: "includes", value: 10.5 }, "9, 10.5 ,11")).toBe(true);
    expect(ruleHolds({ key: "sizes_available", op: "includes", value: "1" }, "9,10,11")).toBe(false);
    expect(ruleHolds({ key: "count", op: "includes", value: "1" }, 1)).toBe(false);
  });
  it("a missing attribute fails every operator", () => {
    for (const op of ["eq", "gte", "lte", "includes"] as const) {
      expect(ruleHolds({ key: "x", op, value: 1 }, undefined)).toBe(false);
    }
  });
});
