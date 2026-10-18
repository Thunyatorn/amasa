import { z } from "zod";
import { AttrKey, AttrValue, Category, Sku } from "./contract.ts";

// SPEC §2.3. Structured listing from the store API. Strings are merchant-written and untrusted.
export const StoreListing = z.strictObject({
  merchant: z.string(),                           // "demo-store"
  sku: Sku,
  title: z.string().max(80),
  brand: z.string().max(40),
  category: Category,
  unitCents: z.number().int().positive(),
  returnDays: z.number().int().min(0),
  deliveryDays: z.number().int().min(0),
  stock: z.number().int().min(0),
  rating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
  sponsored: z.boolean(),
  attributes: z.record(AttrKey, AttrValue),
});
export type StoreListing = z.infer<typeof StoreListing>;

// SPEC §2.4. Untrusted text: only the reader and the scanner ever see it.
export const ProductPage = z.strictObject({
  sku: Sku,
  description: z.string().max(2000),
  reviews: z.array(z.strictObject({
    id: z.string().max(24),
    rating: z.number().int().min(1).max(5),
    text: z.string().max(1000),
  })).max(20),
});
export type ProductPage = z.infer<typeof ProductPage>;

// SPEC §2.5. Authoritative price, from the store.
export const Quote = z.strictObject({
  quoteId: z.string(),
  merchant: z.string(),
  currency: z.literal("USD"),
  lines: z.array(z.strictObject({
    sku: Sku, title: z.string().max(80), qty: z.number().int().positive(),
    unitCents: z.number().int().positive(), lineCents: z.number().int().positive(),
    returnDays: z.number().int().min(0), deliveryDays: z.number().int().min(0),
  })).min(1),
  subtotalCents: z.number().int(),
  taxCents: z.number().int(),
  shippingCents: z.number().int(),
  totalCents: z.number().int(),
  quotedAt: z.number().int(),                     // epoch ms
});
export type Quote = z.infer<typeof Quote>;
