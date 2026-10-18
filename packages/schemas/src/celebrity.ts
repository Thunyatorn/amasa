import { z } from "zod";
import { AttrKey, AttrValue, Category, Sku } from "./contract.ts";

// The demo store's catalog source (data/celebrities/demo-set.json). Facts come from Wikidata and each
// entry keeps its source; refund window, stock, rating and reviews are the demo store's own data. The
// price is not here: the celebrity market owns it (startVU is only where the market starts).

export const DemoCelebrity = z.strictObject({
  labelId: z.number().int().min(0),
  sku: Sku,
  name: z.string().min(1).max(80),
  imagefile: z.string().regex(/^[0-9]+_[A-Za-z0-9_-]+\.jpg$/),
  category: Category,
  attributes: z.record(AttrKey, AttrValue),
  startVU: z.number().int().min(40).max(400),
  refundDays: z.number().int().min(0).max(365),
  deliveryDays: z.number().int().min(0).max(30),
  stock: z.number().int().min(0),
  rating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
  description: z.string().min(1).max(2000),
  reviews: z.array(z.string().min(1).max(1000)).max(20),
  source: z.looseObject({
    wikidata: z.string().url().startsWith("https://www.wikidata.org/wiki/Q"),
    qid: z.string().regex(/^Q[1-9][0-9]*$/),
    sitelinks: z.number().int().min(0),
    retrievedAt: z.string(),
  }),
}).refine((c) => c.sku === `CELEB-${c.labelId}` && c.imagefile.startsWith(`${c.labelId}_`), "SKU and photo must match the label id");
export type DemoCelebrity = z.infer<typeof DemoCelebrity>;

export const DemoSet = z.strictObject({
  description: z.string(),
  celebrities: z.array(DemoCelebrity).min(1),
}).refine((s) => new Set(s.celebrities.map((c) => c.labelId)).size === s.celebrities.length, "Duplicate celebrity in the demo set");
export type DemoSet = z.infer<typeof DemoSet>;

// 1 VU = $1.00 in the demo store; market prices are integer micros (1 VU = 1,000,000 micros).
export const MICROS_PER_CENT = 10_000;
export function microsToCents(micros: number): number {
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("Invalid market price");
  return Math.max(1, Math.round(micros / MICROS_PER_CENT));
}
