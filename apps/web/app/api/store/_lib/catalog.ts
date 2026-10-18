import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ProductPage, StoreListing } from "@amasa/schemas";

// MOCK MERCHANT (SPEC §4): treat as an external system. It imports nothing from apps/web/lib,
// and the agent reaches it only over HTTP at STORE_BASE_URL.

export const Catalog = z.strictObject({
  merchant: z.literal("demo-store"),
  taxRateBps: z.number().int().min(0),
  freeShippingOverCents: z.number().int().min(0),
  flatShippingCents: z.number().int().min(0),
  products: z.array(z.strictObject({ listing: StoreListing, page: ProductPage })).min(1),
});
export type Catalog = z.infer<typeof Catalog>;

function findDataFile(): string {
  let dir = resolve(process.cwd());
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("store: could not find the repo root");
    dir = up;
  }
  return join(dir, "data", "products.json");
}

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

let cached: Catalog | undefined;
export function catalog(): Catalog {
  cached ??= parseCatalog(JSON.parse(readFileSync(findDataFile(), "utf8")));
  return cached;
}
