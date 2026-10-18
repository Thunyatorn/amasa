import { sha256 } from "./canon.ts";

// SPEC §2.9: cartHash = sha256({ merchant, currency, lines: [{sku, title, qty, unitCents}], taxCents, shippingCents }).
// Built from the quote by the web app and rebuilt from the PaymentRequest by the payments service.
// Zod-free so the payments service can import it. Only the listed fields are hashed.

export interface CartHashInput {
  merchant: string;
  currency: "USD";
  lines: ReadonlyArray<{ sku: string; title: string; qty: number; unitCents: number }>;
  taxCents: number;
  shippingCents: number;
}

export const cartHash = (c: CartHashInput) => sha256({
  merchant: c.merchant,
  currency: c.currency,
  lines: c.lines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, unitCents: l.unitCents })),
  taxCents: c.taxCents,
  shippingCents: c.shippingCents,
});
