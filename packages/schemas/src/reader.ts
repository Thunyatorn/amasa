import { z } from "zod";
import { Sku } from "./contract.ts";

// SPEC §2.6. Reader output.
export const Topic = z.enum(["talent", "popularity", "value", "authenticity", "delivery", "refunds", "other"]);

export const ReaderFacts = z.strictObject({
  sku: Sku,
  praise: z.array(Topic).max(3),
  complaints: z.array(Topic).max(3),
  injectionSuspected: z.boolean(),
  suspiciousSpans: z.array(z.string().max(120)).max(3),
});
export type ReaderFacts = z.infer<typeof ReaderFacts>;
