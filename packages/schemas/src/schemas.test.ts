import { describe, expect, it } from "vitest";
import { canon, cartHash, Contract, priceLines, sha256, shippingCents, StoreListing, taxCents } from "./index.ts";

const PRICING = { taxRateBps: 800, freeShippingOverCents: 10000, flatShippingCents: 599 };

describe("canon / sha256 (SPEC §2.1, §9.3)", () => {
  it("key order does not change the hash", () => {
    expect(sha256({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } }))
      .toBe(sha256({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }));
  });
  it("undefined keys are dropped", () => {
    expect(canon({ a: 1, b: undefined })).toBe(canon({ a: 1 }));
    expect(canon({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it("NaN throws (and so does Infinity)", () => {
    expect(() => canon(NaN)).toThrow();
    expect(() => canon({ a: [1, NaN] })).toThrow();
    expect(() => sha256({ a: Infinity })).toThrow();
  });
  it("array order is kept", () => {
    expect(sha256([1, 2])).not.toBe(sha256([2, 1]));
  });
});

describe("pricing (SPEC §4.1, §17.2)", () => {
  it("$129.00 -> tax $10.32, free shipping, total $139.32", () => {
    expect(priceLines([{ unitCents: 12900, qty: 1 }], PRICING))
      .toEqual({ subtotalCents: 12900, taxCents: 1032, shippingCents: 0, totalCents: 13932 });
  });
  it("$117.00 -> tax $9.36, total $126.36", () => {
    expect(priceLines([{ unitCents: 11700, qty: 1 }], PRICING))
      .toEqual({ subtotalCents: 11700, taxCents: 936, shippingCents: 0, totalCents: 12636 });
  });
  it("$159.00 (SHOE-CHEAP-09) -> total $171.72", () => {
    expect(priceLines([{ unitCents: 15900, qty: 1 }], PRICING).totalCents).toBe(17172);
  });
  it("shipping is charged below $100.00 and free at exactly $100.00", () => {
    expect(shippingCents(9999, 10000, 599)).toBe(599);
    expect(shippingCents(10000, 10000, 599)).toBe(0);
    expect(priceLines([{ unitCents: 5000, qty: 1 }], PRICING).totalCents).toBe(5000 + 400 + 599);
  });
  it("tax rounds to the nearest cent", () => {
    expect(taxCents(1006, 800)).toBe(80);   // 80.48
    expect(taxCents(1007, 800)).toBe(81);   // 80.56
  });
  it("rejects non-integer money", () => {
    expect(() => priceLines([{ unitCents: 12.5, qty: 1 }], PRICING)).toThrow();
  });
});

describe("schemas are strict", () => {
  const contract = {
    id: "11111111-1111-4111-8111-111111111111", category: "actors", goal: "shoes",
    quantity: 1, budgetCapCents: 14000, mustHave: [], allowedMerchants: ["demo-store"],
    minReturnDays: 14, confirmedAt: "2026-10-17T11:00:00.000Z",
  };
  it("accepts a valid contract and rejects unknown keys", () => {
    expect(Contract.safeParse(contract).success).toBe(true);
    expect(Contract.safeParse({ ...contract, autonomyLevel: 2 }).success).toBe(false);
  });
  it("rejects fractional cents", () => {
    expect(Contract.safeParse({ ...contract, budgetCapCents: 140.5 }).success).toBe(false);
  });
  it("rejects bad SKUs and attribute keys in listings", () => {
    const listing = {
      merchant: "demo-store", sku: "SHOE-WIDE-01", title: "t", brand: "b", category: "actors",
      unitCents: 12900, returnDays: 30, deliveryDays: 3, stock: 1, rating: 4, reviewCount: 1,
      sponsored: false, attributes: { width: "wide" },
    };
    expect(StoreListing.safeParse(listing).success).toBe(true);
    expect(StoreListing.safeParse({ ...listing, sku: "shoe wide" }).success).toBe(false);
    expect(StoreListing.safeParse({ ...listing, attributes: { "Bad-Key": "x" } }).success).toBe(false);
  });
});

describe("cartHash (SPEC §2.9)", () => {
  const base = {
    merchant: "demo-store", currency: "USD" as const, taxCents: 1032, shippingCents: 0,
    lines: [{ sku: "SHOE-WIDE-01", title: "Wide Road Runner", qty: 1, unitCents: 12900 }],
  };
  it("ignores extra line fields (lineCents, returnDays...) and changes with any priced field", () => {
    const withExtras = { ...base, lines: [{ ...base.lines[0]!, lineCents: 12900, returnDays: 30 }] };
    expect(cartHash(withExtras)).toBe(cartHash(base));
    expect(cartHash({ ...base, lines: [{ ...base.lines[0]!, unitCents: 12800 }] })).not.toBe(cartHash(base));
    expect(cartHash({ ...base, taxCents: 1031 })).not.toBe(cartHash(base));
  });
});
