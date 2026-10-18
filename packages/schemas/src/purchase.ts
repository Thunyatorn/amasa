import { z } from "zod";
import { Category } from "./contract.ts";

// SPEC §2.12.
export const PurchaseStatus = z.enum(["verified", "blocked", "approved", "link_created",
  "payment_failed", "kept", "returned"]);
export type PurchaseStatus = z.infer<typeof PurchaseStatus>;

export const Purchase = z.strictObject({
  purchaseNumber: z.string().regex(/^[A-Z0-9]{16}$/),
  cartId: z.string().uuid(),
  contractId: z.string().uuid(),
  category: Category,
  status: PurchaseStatus,
  totalCents: z.number().int(),
  paymentLinkUrl: z.string().url().nullable(),
  createdAt: z.string(),
});
export type Purchase = z.infer<typeof Purchase>;

export const AuditEntry = z.strictObject({
  seq: z.number().int().min(1),
  ts: z.string(),
  type: z.string(),
  payloadHash: z.string().length(64),
  prevHash: z.string().length(64),
  hash: z.string().length(64),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
