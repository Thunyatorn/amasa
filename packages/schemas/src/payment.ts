import { z } from "zod";
import { sha256 } from "./canon.ts";
import { Category, Sku } from "./contract.ts";

// SPEC §2.9.
export const FailureCode = z.enum([
  "CONTRACT_HASH_MISMATCH", "EMPTY_CART", "SKU_NOT_IN_QUOTE", "MERCHANT_NOT_ALLOWED",
  "TAP_FAILED", "QUOTE_STALE", "CURRENCY_MISMATCH", "OVER_BUDGET", "MUST_HAVE_FAILED",
  "RETURN_WINDOW_SHORT", "DEADLINE_MISSED", "QUANTITY_MISMATCH", "FLAGGED_LISTING",
  "WEEKLY_CAP_EXCEEDED",
]);
export type FailureCode = z.infer<typeof FailureCode>;

export const Verdict = z.strictObject({
  pass: z.boolean(),
  totalCents: z.number().int(),                   // = quote.totalCents
  failures: z.array(z.strictObject({ code: FailureCode, detail: z.string().max(200) })),
});
export type Verdict = z.infer<typeof Verdict>;

export const SignedFields = z.strictObject({
  purchaseNumber: z.string().regex(/^[A-Z0-9]{16}$/), // Visa requires alphanumeric, < 20 chars
  contractHash: z.string().length(64),
  cartHash: z.string().length(64),
  merchant: z.string(),
  category: Category,
  currency: z.literal("USD"),
  totalCents: z.number().int().positive(),
  budgetCapCents: z.number().int().positive(),
  expiresAt: z.number().int(),                    // epoch ms, now + 5 minutes
});
export type SignedFields = z.infer<typeof SignedFields>;

export const PaymentRequest = z.strictObject({
  fields: SignedFields,
  signature: z.string(),                          // base64 Ed25519
  lines: z.array(z.strictObject({
    sku: Sku, title: z.string().max(80), qty: z.number().int().positive(),
    unitCents: z.number().int().positive(),
  })).min(1),
  taxCents: z.number().int().min(0),
  shippingCents: z.number().int().min(0),
});
export type PaymentRequest = z.infer<typeof PaymentRequest>;

export interface CartHashInput {
  merchant: string;
  currency: "USD";
  lines: ReadonlyArray<{ sku: string; title: string; qty: number; unitCents: number }>;
  taxCents: number;
  shippingCents: number;
}

// SPEC §2.9: built from the quote by the web app and rebuilt from the PaymentRequest by the
// payments service. Only these fields are hashed, so extra quote-line fields never leak in.
export const cartHash = (c: CartHashInput) => sha256({
  merchant: c.merchant,
  currency: c.currency,
  lines: c.lines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, unitCents: l.unitCents })),
  taxCents: c.taxCents,
  shippingCents: c.shippingCents,
});
