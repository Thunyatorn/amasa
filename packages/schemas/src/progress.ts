import { z } from "zod";
import { Sku } from "./contract.ts";
import { CompareTable, Option } from "./options.ts";
import { ReaderFacts } from "./reader.ts";

// Added in M4 (documented in SPEC §2.14): what screen 4 needs to explain each option. Everything is
// code-written from store data, except `facts` (the reader's typed summary of reviews) and
// `reviewQuotes` (store review text, shown labeled "Store review", plain text only).
export const OptionProduct = z.strictObject({
  sku: Sku, title: z.string().max(80), brand: z.string().max(40), sponsored: z.boolean(),
  stock: z.number().int().min(0), rating: z.number().min(0).max(5), reviewCount: z.number().int().min(0),
  returnDays: z.number().int().min(0), deliveryDays: z.number().int().min(0),
  facts: ReaderFacts.pick({ fitNotes: true, praise: true, complaints: true }),
  reviewQuotes: z.array(z.string().max(200)).max(2),
});
export type OptionProduct = z.infer<typeof OptionProduct>;

export const OptionDetail = z.strictObject({
  rank: z.number().int().min(1).max(3),
  products: z.array(OptionProduct).min(1).max(5),
  checks: z.array(z.string().max(160)).max(16),
  dataUsed: z.array(z.string().max(160)).max(20),
});
export type OptionDetail = z.infer<typeof OptionDetail>;

// Products that passed every rule but were not proposed ("Show more").
export const OtherSurvivor = z.strictObject({
  sku: Sku, title: z.string().max(80), totalCents: z.number().int(), sponsored: z.boolean(),
});
export type OtherSurvivor = z.infer<typeof OtherSurvivor>;

// SPEC §2.14. Streamed to the UI (§6).
export const ProgressEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("step"), text: z.string().max(140) }),
  z.strictObject({ type: z.literal("flagged"), sku: Sku, reason: z.string().max(140) }),
  z.strictObject({ type: z.literal("filtered"),
    removed: z.array(z.strictObject({ code: z.string(), count: z.number().int() })) }),
  z.strictObject({ type: z.literal("options"), options: z.array(Option).max(3), compare: CompareTable,
    details: z.array(OptionDetail).max(3), others: z.array(OtherSurvivor).max(12) }),
  z.strictObject({ type: z.literal("error"), code: z.string(), message: z.string().max(200) }),
  z.strictObject({ type: z.literal("done") }),
]);
export type ProgressEvent = z.infer<typeof ProgressEvent>;
