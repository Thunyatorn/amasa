import { z } from "zod";
import { Sku } from "./contract.ts";

// SPEC §2.6. Reader output.
export const Topic = z.enum(["fit", "comfort", "durability", "quality", "price",
  "shipping", "returns", "taste", "freshness", "other"]);

export const ReaderFacts = z.strictObject({
  sku: Sku,
  fitNotes: z.array(z.enum(["runs_small", "runs_large", "true_to_size",
    "wide_friendly", "narrow"])).max(3),
  praise: z.array(Topic).max(3),
  complaints: z.array(Topic).max(3),
  injectionSuspected: z.boolean(),
  suspiciousSpans: z.array(z.string().max(120)).max(3),
});
export type ReaderFacts = z.infer<typeof ReaderFacts>;
