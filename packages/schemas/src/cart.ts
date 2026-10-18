import { z } from "zod";
import { Sku } from "./contract.ts";

// SPEC §2.8. A cart never carries prices; totals come from the quote (§4.4).
export const Cart = z.strictObject({
  id: z.string().uuid(),
  contractId: z.string().uuid(),
  contractHash: z.string().length(64),
  merchant: z.string(),
  lines: z.array(z.strictObject({ sku: Sku, qty: z.number().int().positive() })).min(1).max(5),
});
export type Cart = z.infer<typeof Cart>;
