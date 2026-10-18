import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DemoSet, microsToCents, ProductPage, StoreListing, type DemoCelebrity } from "@amasa/schemas";
import { marketPrices } from "./market-prices";
import { repoRootFrom, StoreNotReady } from "./support";

export { StoreNotReady } from "./support";

// MOCK MERCHANT (SPEC §4): treat as an external system. It imports nothing from apps/web/lib,
// and the agent reaches it only over HTTP at STORE_BASE_URL.
//
// The demo store sells celebrities (data/celebrities/demo-set.json). Its prices are the celebrity
// market's current prices (1 VU = $1.00), read on every request, so a price the market moved is the
// price the store quotes.

export const Catalog = z.strictObject({
  merchant: z.literal("demo-store"),
  taxRateBps: z.number().int().min(0),
  freeShippingOverCents: z.number().int().min(0),
  flatShippingCents: z.number().int().min(0),
  products: z.array(z.strictObject({ listing: StoreListing, page: ProductPage })).min(1),
});
export type Catalog = z.infer<typeof Catalog>;

// SPEC §4.1: 8% tax; celebrities are delivered instantly, so there is no shipping.
export const STORE_TERMS = { merchant: "demo-store", taxRateBps: 800, freeShippingOverCents: 0, flatShippingCents: 0 } as const;

export function parseCatalog(raw: unknown): Catalog {
  const catalog = Catalog.parse(raw);
  const skus = new Set<string>();
  for (const p of catalog.products) {
    if (p.listing.sku !== p.page.sku) throw new Error(`store: page SKU mismatch for ${p.listing.sku}`);
    if (p.listing.merchant !== catalog.merchant) throw new Error(`store: wrong merchant for ${p.listing.sku}`);
    if (skus.has(p.listing.sku)) throw new Error(`store: duplicate SKU ${p.listing.sku}`);
    skus.add(p.listing.sku);
  }
  return catalog;
}

export function listingFor(c: DemoCelebrity, unitCents: number): Catalog["products"][number] {
  return {
    listing: {
      merchant: STORE_TERMS.merchant, sku: c.sku, title: c.name, brand: c.name, category: c.category, unitCents,
      returnDays: c.refundDays, deliveryDays: c.deliveryDays, stock: c.stock, rating: c.rating, reviewCount: c.reviewCount,
      sponsored: false, attributes: c.attributes,
    },
    page: { sku: c.sku, description: c.description, reviews: c.reviews.map((text, i) => ({ id: `${c.sku}-R${i + 1}`, rating: 5, text })) },
  };
}

// The catalog for a given set of prices (market micros by label id). Every celebrity needs a price.
export function buildCatalog(set: DemoSet, microsById: ReadonlyMap<number, number>): Catalog {
  return parseCatalog({
    ...STORE_TERMS,
    products: set.celebrities.map((c) => {
      const micros = microsById.get(c.labelId);
      if (micros === undefined) throw new StoreNotReady(`No market price for ${c.sku}`);
      return listingFor(c, microsToCents(micros));
    }),
  });
}

// Starting prices only (no market): used by tests and the red-team harness, which need fixed prices.
export const startPrices = (set: DemoSet) => new Map(set.celebrities.map((c) => [c.labelId, c.startVU * 1_000_000] as const));

let cachedSet: DemoSet | undefined;
export function demoSet(): DemoSet {
  cachedSet ??= DemoSet.parse(JSON.parse(readFileSync(join(repoRootFrom(), "data", "celebrities", "demo-set.json"), "utf8")));
  return cachedSet;
}

// The live catalog: the demo set with the market's current prices.
export function catalog(): Catalog {
  const set = demoSet();
  return buildCatalog(set, marketPrices(set.celebrities.map((c) => c.labelId)));
}

// Route helper: a store without market prices answers 503 instead of guessing a price.
export function withCatalog(fn: (c: Catalog) => Response | Promise<Response>): Promise<Response> {
  let current: Catalog;
  try {
    current = catalog();
  } catch (error) {
    if (error instanceof StoreNotReady) {
      return Promise.resolve(Response.json({ code: "STORE_NOT_READY", message: "The demo store has no prices yet. Run pnpm seed." }, { status: 503 }));
    }
    throw error;
  }
  return Promise.resolve(fn(current));
}
