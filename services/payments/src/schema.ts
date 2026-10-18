import { z } from "zod";

// zod 3 copy of SignedFields and PaymentRequest (SPEC §2.9), as SPEC §10.3 step 2 requires.
// Kept identical to packages/schemas/src/payment.ts; schema-parity.test.ts checks they agree.
// (zod 3 has no z.strictObject; .strict() is the equivalent.)

const Category = z.enum(["running-shoes", "groceries", "household"]);
const Sku = z.string().regex(/^[A-Z0-9-]{3,24}$/);

export const SignedFields = z.object({
  purchaseNumber: z.string().regex(/^[A-Z0-9]{16}$/),
  contractHash: z.string().length(64),
  cartHash: z.string().length(64),
  merchant: z.string(),
  category: Category,
  currency: z.literal("USD"),
  totalCents: z.number().int().positive(),
  budgetCapCents: z.number().int().positive(),
  expiresAt: z.number().int(),
}).strict();
export type SignedFields = z.infer<typeof SignedFields>;

export const PaymentRequest = z.object({
  fields: SignedFields,
  signature: z.string(),
  lines: z.array(z.object({
    sku: Sku, title: z.string().max(80), qty: z.number().int().positive(),
    unitCents: z.number().int().positive(),
  }).strict()).min(1),
  taxCents: z.number().int().min(0),
  shippingCents: z.number().int().min(0),
}).strict();
export type PaymentRequest = z.infer<typeof PaymentRequest>;
