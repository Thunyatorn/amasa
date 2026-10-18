import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { priceLines, type Contract } from "@amasa/schemas";
import { budgetRule, mustHaveRule, returnWindowRule } from "@amasa/verifier";
import { buildCatalog, demoSet, parseCatalog, startPrices, STORE_TERMS, StoreNotReady } from "./catalog";
import { quote, search } from "./logic";
import { marketPrices } from "./market-prices";
import { repoRootFrom } from "./support";

// The store with fixed prices: every celebrity at its starting price (the live store reads the market).
const set = demoSet();
const c = buildCatalog(set, startPrices(set));
const bySku = (sku: string) => c.products.find((p) => p.listing.sku === sku)!;
const csv = readFileSync(join(repoRootFrom(), "data", "celebrities", "metadata.csv"), "utf8").split("\n").slice(1).filter(Boolean)
  .map((line) => line.split(","));

describe("data/celebrities/demo-set.json (SPEC §17.1)", () => {
  it("has 39 valid celebrities: 14 actors, 13 musicians, 12 athletes; 8% tax, no shipping", () => {
    expect(c.products).toHaveLength(39);
    const count = (cat: string) => c.products.filter((p) => p.listing.category === cat).length;
    expect([count("actors"), count("musicians"), count("athletes")]).toEqual([14, 13, 12]);
    expect([c.taxRateBps, c.freeShippingOverCents, c.flatShippingCents]).toEqual([800, 0, 0]);
  });
  it("every entry is a real label in metadata.csv with its own photo file name", () => {
    for (const celeb of set.celebrities) {
      const row = csv.find((r) => Number(r[0]) === celeb.labelId);
      expect(row?.[1], celeb.sku).toBe(celeb.name);
      expect(row?.[2], celeb.sku).toBe(celeb.imagefile);
    }
  });
  it("every celebrity has its category's attribute, a sourced Wikidata id, and no demographic attributes", () => {
    const keys = { actors: ["oscar"], musicians: ["genre"], athletes: ["sport"] } as const;
    for (const celeb of set.celebrities) {
      expect(Object.keys(celeb.attributes), celeb.sku).toEqual(keys[celeb.category]);
      expect(celeb.source.wikidata).toBe(`https://www.wikidata.org/wiki/${celeb.source.qid}`);
      expect(Object.keys(celeb.attributes).some((k) => /age|birth|national|country|gender|ethnic|religio/.test(k))).toBe(false);
    }
  });
  it("starting prices follow the rule: 2 VU per Wikipedia language edition, 40 to 400 VU", () => {
    for (const celeb of set.celebrities) expect(celeb.startVU, celeb.sku).toBe(Math.max(40, Math.min(400, 2 * celeb.source.sitelinks)));
  });
  it("rejects a catalog with a duplicate SKU or a mismatched page", () => {
    const raw = structuredClone(c);
    raw.products.push(structuredClone(raw.products[0]!));
    expect(() => parseCatalog(raw)).toThrow(/duplicate/);
    const raw2 = structuredClone(c);
    raw2.products[0]!.page.sku = "CELEB-OTHER";
    expect(() => parseCatalog(raw2)).toThrow(/mismatch/);
  });
});

describe("prices come from the celebrity market (1 VU = $1.00)", () => {
  it("converts market micros to cents, rounding to the nearest cent", () => {
    const prices = startPrices(set);
    prices.set(942, 212_345_678);
    expect(buildCatalog(set, prices).products.find((p) => p.listing.sku === "CELEB-942")!.listing.unitCents).toBe(21235);
  });
  it("refuses to build a catalog when a celebrity has no market price", () => {
    const prices = startPrices(set);
    prices.delete(942);
    expect(() => buildCatalog(set, prices)).toThrow(StoreNotReady);
  });
  const dir = mkdtempSync(join(tmpdir(), "amasa-store-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("reads current_micros from the market table, and reports an unseeded market as not ready", () => {
    const path = join(dir, "market.db");
    const db = new Database(path);
    db.exec("CREATE TABLE market_celebrities (id INTEGER PRIMARY KEY, current_micros INTEGER NOT NULL)");
    db.prepare("INSERT INTO market_celebrities VALUES (942, 272000000), (914, 356123456)").run();
    db.close();
    const previous = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path;
    try {
      expect([...marketPrices([942, 914, 15])]).toEqual([[914, 356123456], [942, 272000000]]);
      process.env.DATABASE_PATH = join(dir, "missing.db");
      expect(() => marketPrices([942])).toThrow(StoreNotReady);
      const empty = join(dir, "empty.db");
      new Database(empty).close();
      process.env.DATABASE_PATH = empty;
      expect(() => marketPrices([942])).toThrow(StoreNotReady);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    }
  });
});

describe("demo contract: an Oscar winner for at most 300 VU including tax", () => {
  const contract = {
    id: "11111111-1111-4111-8111-111111111111", category: "actors", goal: "demo", quantity: 1,
    budgetCapCents: 30000, minReturnDays: 14, allowedMerchants: ["demo-store"], confirmedAt: "2026-10-17T00:00:00.000Z",
    mustHave: [{ key: "oscar", op: "eq", value: "yes" }],
  } satisfies Contract;

  it("passes exactly the Oscar winners whose total fits, using the verifier's own rule functions", () => {
    const passing = c.products.filter(({ listing: l }) => {
      if (l.category !== "actors") return false;
      const total = priceLines([{ unitCents: l.unitCents, qty: 1 }], c).totalCents;
      return mustHaveRule(contract, [l.sku], { [l.sku]: l }).length === 0 && budgetRule(contract, total).length === 0
        && returnWindowRule(contract, [l]).length === 0 && l.stock >= contract.quantity;
    }).map((p) => p.listing.title);
    expect(passing.sort()).toEqual(["Cate Blanchett", "Denzel Washington", "Emma Stone", "Meryl Streep", "Morgan Freeman", "Natalie Portman", "Tom Hanks", "Viola Davis"]);
  });
  it("Leonardo DiCaprio is an Oscar winner but over budget: 298 VU + 8% tax = 321.84 VU", () => {
    const l = bySku("CELEB-599").listing;
    expect(mustHaveRule(contract, [l.sku], { [l.sku]: l })).toEqual([]);
    expect(priceLines([{ unitCents: l.unitCents, qty: 1 }], c).totalCents).toBe(32184);
  });
});

describe("POST /api/store/quote logic (SPEC §4.4)", () => {
  it("Tom Hanks quotes 293.76 VU (272.00 + 21.76 tax, no shipping)", () => {
    const r = quote(c, [{ sku: "CELEB-942", qty: 1 }], 1_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote).toMatchObject({ merchant: STORE_TERMS.merchant, currency: "USD", subtotalCents: 27200, taxCents: 2176,
      shippingCents: 0, totalCents: 29376, quotedAt: 1_000 });
    expect(r.quote.lines[0]).toMatchObject({ sku: "CELEB-942", title: "Tom Hanks", qty: 1, unitCents: 27200, lineCents: 27200, returnDays: 14, deliveryDays: 0 });
  });
  it("merges duplicate SKUs", () => {
    const r = quote(c, [{ sku: "CELEB-919", qty: 1 }, { sku: "CELEB-919", qty: 1 }], 0);
    expect(r.ok && r.quote.lines).toHaveLength(1);
    expect(r.ok && r.quote.lines[0]!.qty).toBe(2);
  });
  it("refuses unknown SKUs and short stock", () => {
    expect(quote(c, [{ sku: "NOPE-1234", qty: 1 }], 0)).toMatchObject({ ok: false, code: "UNKNOWN_SKU" });
    const sold = structuredClone(c);
    sold.products.find((p) => p.listing.sku === "CELEB-942")!.listing.stock = 0;
    expect(quote(sold, [{ sku: "CELEB-942", qty: 1 }], 0)).toMatchObject({ ok: false, code: "OUT_OF_STOCK" });
  });
});

describe("GET /api/store/search logic (SPEC §4.2)", () => {
  it("finds Oscar winners for the queries a planner writes, filtered by category, at most 12", () => {
    for (const q of ["oscar winning actor", "Oscar-winning actors", "academy award winner"]) {
      const r = search(c, q, "actors", 50);
      expect(r.length).toBeLessThanOrEqual(12);
      expect(r.every((l) => l.category === "actors")).toBe(true);
      expect(r.slice(0, 10).every((l) => l.attributes.oscar === "yes"), q).toBe(true);
    }
  });
  it("finds musicians by genre and athletes by sport", () => {
    expect(search(c, "pop musician", "musicians", 12).map((l) => l.title)).toContain("Taylor Swift");
    expect(search(c, "hip-hop", "musicians", 2).map((l) => l.title).sort()).toEqual(["Ed Sheeran", "Jay-Z"]);
    expect(search(c, "tennis player", "athletes", 3).map((l) => l.title).sort()).toEqual(["Novak Djokovic", "Roger Federer", "Serena Williams"]);
    expect(search(c, "Taylor Swift", "musicians", 1)[0]!.sku).toBe("CELEB-914");
  });
  it("respects the limit and the category filter", () => {
    expect(search(c, "", "athletes", 3)).toHaveLength(3);
    expect(search(c, "tennis", "actors", 12)).toHaveLength(0);
  });
});
