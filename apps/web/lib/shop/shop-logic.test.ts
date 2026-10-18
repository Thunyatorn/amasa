import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DemoSet, priceLines, StoreListing, type Contract, type Option } from "@amasa/schemas";
import { repoRoot } from "../paths.ts";
import { STORE_PRICING } from "../merchants.ts";
import { prefilter } from "./prefilter.ts";
import { buildOptions, compareTable, money, tradeoff } from "./compare.ts";

// The store is an external system, so listings are built from its data file at the starting prices.
const set = DemoSet.parse(JSON.parse(readFileSync(join(repoRoot(), "data/celebrities/demo-set.json"), "utf8")));
const catalog = new Map(set.celebrities.map((c) => [c.sku, StoreListing.parse({ merchant: "demo-store", sku: c.sku, title: c.name, brand: c.name,
  category: c.category, unitCents: c.startVU * 100, returnDays: c.refundDays, deliveryDays: c.deliveryDays, stock: c.stock, rating: c.rating,
  reviewCount: c.reviewCount, sponsored: false, attributes: c.attributes })] as const));
const demo: Contract = {
  id: "11111111-1111-4111-8111-111111111111", category: "musicians", goal: "demo", quantity: 1, budgetCapCents: 30000,
  minReturnDays: 14, allowedMerchants: ["demo-store"], confirmedAt: "2026-10-18T00:00:00.000Z",
  mustHave: [{ key: "genre", op: "includes", value: "pop" }],
};
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const ADELE = "CELEB-15", ED = "CELEB-234";

describe("demo pricing (SPEC §4.1)", () => {
  it("uses the store's terms: 8% tax and no shipping", () => {
    expect(STORE_PRICING).toEqual({ taxRateBps: 800, freeShippingOverCents: 0, flatShippingCents: 0 });
  });
  it("checks the arithmetic: 272.00 VU + 8% = 293.76 VU and 188.00 VU + 8% = 203.04 VU", () => {
    expect(priceLines([{ unitCents: 27200, qty: 1 }], STORE_PRICING)).toEqual({ subtotalCents: 27200, taxCents: 2176, shippingCents: 0, totalCents: 29376 });
    expect(priceLines([{ unitCents: 18800, qty: 1 }], STORE_PRICING)).toEqual({ subtotalCents: 18800, taxCents: 1504, shippingCents: 0, totalCents: 20304 });
    expect(money(29376 - 20304)).toBe("90.72 VU");
  });
});

describe("prefilter (SPEC §7.4 step 5)", () => {
  it("leaves the pop musicians within budget and refund rules, counting each removal once", () => {
    const musicians = [...catalog.values()].filter((l) => l.category === "musicians").map((listing) => ({ listing }));
    const { survivors, removed } = prefilter(demo, musicians, STORE_PRICING, NOW);
    expect(survivors.map((s) => s.listing.title).sort()).toEqual(["Adele", "Billie Eilish", "Dua Lipa", "Ed Sheeran", "Harry Styles", "The Weeknd"]);
    expect(removed).toEqual([{ code: "MUST_HAVE_FAILED", count: 1 }, { code: "OVER_BUDGET", count: 5 }, { code: "RETURN_WINDOW_SHORT", count: 1 }]);
    expect(removed.reduce((sum, r) => sum + r.count, 0) + survivors.length).toBe(musicians.length);
  });
  it("judges price on the store's own numbers: Taylor Swift at 356 VU + tax is over a 300 VU budget", () => {
    expect(prefilter(demo, [{ listing: catalog.get("CELEB-914")! }], STORE_PRICING, NOW).removed).toEqual([{ code: "OVER_BUDGET", count: 1 }]);
  });
  it("applies merchant, quantity and deadline rules (delivery is instant)", () => {
    const adele = { listing: catalog.get(ADELE)! };
    expect(prefilter({ ...demo, allowedMerchants: ["other-store"] }, [adele], STORE_PRICING, NOW).removed[0]!.code).toBe("MERCHANT_NOT_ALLOWED");
    expect(prefilter({ ...demo, quantity: 26, budgetCapCents: 500_000 }, [adele], STORE_PRICING, NOW).removed[0]!.code).toBe("OUT_OF_STOCK");
    expect(prefilter({ ...demo, deadline: "2026-10-17" }, [adele], STORE_PRICING, NOW).removed[0]!.code).toBe("DEADLINE_MISSED");
    expect(prefilter({ ...demo, deadline: "2026-10-18" }, [adele], STORE_PRICING, NOW).survivors).toHaveLength(1);
  });
});

describe("options and compare table (SPEC §7.4 step 7)", () => {
  const proposal = (sku: string, reason = "Pop, within your 300 VU budget.") => ({ lines: [{ sku, qty: 1 }], reason });
  it("computes estimates from store listings and strips urgency from reasons", () => {
    const [one, two] = buildOptions([proposal(ADELE), proposal(ED, "Cheaper. Hurry, selling fast!")], catalog, STORE_PRICING);
    expect(one).toEqual({ rank: 1, lines: [{ sku: ADELE, qty: 1 }], reason: "Pop, within your 300 VU budget.",
      estimate: { totalCents: 29376, deliveryDays: 0, returnDays: 14 } });
    expect(two).toMatchObject({ rank: 2, reason: "Cheaper.", estimate: { totalCents: 20304, deliveryDays: 0, returnDays: 14 } });
  });
  it.each([["Adele first", [ADELE, ED]], ["Ed Sheeran first", [ED, ADELE]]])(
    "highlights Total and says \"90.72 VU cheaper but a 4.4 rating\" with %s", (_, order) => {
      const options = buildOptions(order.map((sku) => proposal(sku)), catalog, STORE_PRICING);
      const table = compareTable(options, catalog, demo);
      expect(table.tradeoff).toBe("90.72 VU cheaper but a 4.4 rating");
      expect(table.rows.filter((row) => row.highlight).map((row) => row.label)).toEqual(["Total"]);
      expect(table.rows.map((row) => row.label)).toEqual(["Total", "Delivery", "Refund window", "genre includes pop", "Rating"]);
      expect(table.rows.find((row) => row.label === "Delivery")!.values).toEqual(["Instant", "Instant"]);
      expect(table.skus).toEqual(order);
      expect(table.rows.find((row) => row.label === "genre includes pop")!.values).toEqual(["Yes", "Yes"]);
    });
  it("names a shorter refund window as the downside when it is the biggest one", () => {
    const options = buildOptions([proposal("CELEB-914"), proposal("CELEB-546")], catalog, STORE_PRICING);
    expect(tradeoff(options, catalog)).toBe("90.72 VU cheaper but a 7-day refund window");
  });
  it("covers one option, no options, equal prices and a cheaper option with no downside", () => {
    const one = buildOptions([proposal(ADELE)], catalog, STORE_PRICING);
    expect(compareTable(one, catalog, demo)).toMatchObject({ tradeoff: "Only one product fits your contract." });
    expect(compareTable(one, catalog, demo).rows.some((row) => row.highlight)).toBe(false);
    expect(compareTable([], catalog, demo)).toEqual({ skus: [], rows: expect.any(Array), tradeoff: "" });
    const same: Option[] = buildOptions([proposal(ADELE), proposal(ADELE)], catalog, STORE_PRICING);
    expect(tradeoff(same, catalog)).toBe("The options cost the same.");
    const better = new Map(catalog);
    better.set(ED, { ...catalog.get(ED)!, rating: 4.9 });
    expect(tradeoff(buildOptions([proposal(ADELE), proposal(ED)], better, STORE_PRICING), better))
      .toBe("90.72 VU cheaper with no downside on delivery, refunds or rating");
  });
});
