import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceLines, StoreListing, type Contract, type Option } from "@amasa/schemas";
import { repoRoot } from "../paths.ts";
import { STORE_PRICING } from "../merchants.ts";
import { prefilter } from "./prefilter.ts";
import { buildOptions, compareTable, money, tradeoff } from "./compare.ts";

const data = JSON.parse(readFileSync(join(repoRoot(), "data/products.json"), "utf8")) as {
  taxRateBps: number; freeShippingOverCents: number; flatShippingCents: number; products: { listing: unknown }[];
};
const catalog = new Map(data.products.map(({ listing }) => { const l = StoreListing.parse(listing); return [l.sku, l] as const; }));
const demo: Contract = {
  id: "11111111-1111-4111-8111-111111111111", category: "running-shoes", goal: "demo", quantity: 1, budgetCapCents: 14000,
  minReturnDays: 14, allowedMerchants: ["demo-store"], confirmedAt: "2026-10-18T00:00:00.000Z",
  mustHave: [{ key: "width", op: "eq", value: "wide" }, { key: "sizes_available", op: "includes", value: "10.5" }, { key: "use", op: "eq", value: "road" }],
};
const NOW = Date.parse("2026-10-18T12:00:00.000Z");

describe("demo pricing (SPEC §4.1, §17.2)", () => {
  it("uses the same rules as the store", () => {
    expect(STORE_PRICING).toEqual({ taxRateBps: data.taxRateBps, freeShippingOverCents: data.freeShippingOverCents, flatShippingCents: data.flatShippingCents });
  });
  it("checks the SPEC arithmetic: $129.00 × 8% = $10.32 and $117.00 × 8% = $9.36", () => {
    expect(priceLines([{ unitCents: 12900, qty: 1 }], STORE_PRICING)).toEqual({ subtotalCents: 12900, taxCents: 1032, shippingCents: 0, totalCents: 13932 });
    expect(priceLines([{ unitCents: 11700, qty: 1 }], STORE_PRICING)).toEqual({ subtotalCents: 11700, taxCents: 936, shippingCents: 0, totalCents: 12636 });
    expect(money(13932 - 12636)).toBe("$12.96");
  });
});

describe("prefilter (SPEC §7.4 step 5)", () => {
  it("leaves only SHOE-WIDE-01 and SHOE-WIDE-02 of the running shoes, counting each removal once", () => {
    const shoes = [...catalog.values()].filter((l) => l.category === "running-shoes" && l.sku !== "SHOE-LUX-01").map((listing) => ({ listing }));
    const { survivors, removed } = prefilter(demo, shoes, STORE_PRICING, NOW);
    expect(survivors.map((s) => s.listing.sku).sort()).toEqual(["SHOE-WIDE-01", "SHOE-WIDE-02"]);
    expect(removed).toEqual([{ code: "OUT_OF_STOCK", count: 1 }, { code: "MUST_HAVE_FAILED", count: 12 },
      { code: "OVER_BUDGET", count: 3 }, { code: "RETURN_WINDOW_SHORT", count: 1 }]);
    expect(removed.reduce((sum, r) => sum + r.count, 0) + survivors.length).toBe(shoes.length);
  });
  it("removes the price lie on the store's own numbers: SHOE-CHEAP-09 is over budget", () => {
    expect(prefilter(demo, [{ listing: catalog.get("SHOE-CHEAP-09")! }], STORE_PRICING, NOW).removed).toEqual([{ code: "OVER_BUDGET", count: 1 }]);
  });
  it("applies merchant, quantity and deadline rules", () => {
    const wide01 = { listing: catalog.get("SHOE-WIDE-01")! };
    expect(prefilter({ ...demo, allowedMerchants: ["other-store"] }, [wide01], STORE_PRICING, NOW).removed[0]!.code).toBe("MERCHANT_NOT_ALLOWED");
    expect(prefilter({ ...demo, quantity: 13 }, [wide01], STORE_PRICING, NOW).removed[0]!.code).toBe("OUT_OF_STOCK");
    expect(prefilter({ ...demo, deadline: "2026-10-19" }, [wide01], STORE_PRICING, NOW).removed[0]!.code).toBe("DEADLINE_MISSED");
    expect(prefilter({ ...demo, deadline: "2026-10-21" }, [wide01], STORE_PRICING, NOW).survivors).toHaveLength(1);
  });
});

describe("options and compare table (SPEC §7.4 step 7)", () => {
  const proposal = (sku: string, reason = "Wide, size 10.5, within your budget.") => ({ lines: [{ sku, qty: 1 }], reason });
  it("computes estimates from store listings and strips urgency from reasons", () => {
    const [one, two] = buildOptions([proposal("SHOE-WIDE-01"), proposal("SHOE-WIDE-02", "Cheaper. Hurry, selling fast!")], catalog, STORE_PRICING);
    expect(one).toEqual({ rank: 1, lines: [{ sku: "SHOE-WIDE-01", qty: 1 }], reason: "Wide, size 10.5, within your budget.",
      estimate: { totalCents: 13932, deliveryDays: 3, returnDays: 30 } });
    expect(two).toMatchObject({ rank: 2, reason: "Cheaper.", estimate: { totalCents: 12636, deliveryDays: 5, returnDays: 14 } });
  });
  it.each([["WIDE-01 first", ["SHOE-WIDE-01", "SHOE-WIDE-02"]], ["WIDE-02 first", ["SHOE-WIDE-02", "SHOE-WIDE-01"]]])(
    "highlights Returns and says \"$12.96 cheaper but 14-day returns\" with %s", (_, order) => {
      const options = buildOptions(order.map((sku) => proposal(sku)), catalog, STORE_PRICING);
      const table = compareTable(options, catalog, demo);
      expect(table.tradeoff).toBe("$12.96 cheaper but 14-day returns");
      expect(table.rows.filter((row) => row.highlight).map((row) => row.label)).toEqual(["Returns"]);
      expect(table.rows.map((row) => row.label)).toEqual(["Total", "Delivery", "Returns", "width is wide", "sizes available includes 10.5", "use is road", "Rating"]);
      expect(table.skus).toEqual(order);
      expect(table.rows.find((row) => row.label === "width is wide")!.values).toEqual(["Yes", "Yes"]);
    });
  it("covers one option, no options, equal prices and a cheaper option with no downside", () => {
    const one = buildOptions([proposal("SHOE-WIDE-01")], catalog, STORE_PRICING);
    expect(compareTable(one, catalog, demo)).toMatchObject({ tradeoff: "Only one product fits your contract." });
    expect(compareTable(one, catalog, demo).rows.some((row) => row.highlight)).toBe(false);
    expect(compareTable([], catalog, demo)).toEqual({ skus: [], rows: expect.any(Array), tradeoff: "" });
    const same: Option[] = buildOptions([proposal("SHOE-WIDE-01"), proposal("SHOE-WIDE-01")], catalog, STORE_PRICING);
    expect(tradeoff(same, catalog)).toBe("The options cost the same.");
    const better = new Map(catalog);
    better.set("SHOE-WIDE-02", { ...catalog.get("SHOE-WIDE-02")!, returnDays: 30, deliveryDays: 3, rating: 4.6 });
    expect(tradeoff(buildOptions([proposal("SHOE-WIDE-01"), proposal("SHOE-WIDE-02")], better, STORE_PRICING), better))
      .toBe("$12.96 cheaper with no downside on delivery, returns or rating");
  });
});
