import { z } from "zod";
import { Sku } from "./contract.ts";

// SPEC §2.7. Built by code, except `reason`.
export const Option = z.strictObject({
  rank: z.number().int().min(1).max(3),
  lines: z.array(z.strictObject({ sku: Sku, qty: z.number().int().positive() })).min(1).max(5),
  reason: z.string().max(120),                    // planner-written, plain text, urgency stripped
  estimate: z.strictObject({                      // code-computed from listings (§4.1 rules)
    totalCents: z.number().int(), deliveryDays: z.number().int(), returnDays: z.number().int(),
  }),
});
export type Option = z.infer<typeof Option>;

export const CompareTable = z.strictObject({
  skus: z.array(Sku).max(3),
  rows: z.array(z.strictObject({
    label: z.string(), values: z.array(z.string()), highlight: z.boolean(),
  })),
  tradeoff: z.string().max(140),                  // code-written, e.g. "$12.96 cheaper but 14-day returns"
});
export type CompareTable = z.infer<typeof CompareTable>;
