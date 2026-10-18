import { describe, expect, it } from "vitest";
import { PaymentRequest as Zod4PaymentRequest } from "@amasa/schemas";
import { PaymentRequest as Zod3PaymentRequest } from "./schema";

// SPEC §10.3 step 2: the zod 3 copy must accept and reject exactly what the zod 4 schema does.
const valid = {
  fields: {
    purchaseNumber: "ABCDEF0123456789", contractHash: "c".repeat(64), cartHash: "d".repeat(64),
    merchant: "demo-store", category: "actors", currency: "USD",
    totalCents: 13932, budgetCapCents: 14000, expiresAt: 1_800_000_000_000,
  },
  signature: "c2ln",
  lines: [{ sku: "SHOE-WIDE-01", title: "Stride Wide Road Running Shoe", qty: 1, unitCents: 12900 }],
  taxCents: 1032,
  shippingCents: 0,
};
type Mut = (o: any) => void;
const variants: Array<[string, Mut]> = [
  ["valid", () => {}],
  ["extra top-level key", (o) => { o.extra = 1; }],
  ["extra field key", (o) => { o.fields.extra = 1; }],
  ["extra line key", (o) => { o.lines[0].extra = 1; }],
  ["lowercase purchase number", (o) => { o.fields.purchaseNumber = "abcdef0123456789"; }],
  ["17-char purchase number", (o) => { o.fields.purchaseNumber = "ABCDEF01234567890"; }],
  ["short contract hash", (o) => { o.fields.contractHash = "c"; }],
  ["unknown category", (o) => { o.fields.category = "cars"; }],
  ["EUR currency", (o) => { o.fields.currency = "EUR"; }],
  ["zero total", (o) => { o.fields.totalCents = 0; }],
  ["fractional cents", (o) => { o.lines[0].unitCents = 12.5; }],
  ["negative tax", (o) => { o.taxCents = -1; }],
  ["no lines", (o) => { o.lines = []; }],
  ["bad sku", (o) => { o.lines[0].sku = "shoe wide"; }],
  ["81-char title", (o) => { o.lines[0].title = "x".repeat(81); }],
  ["missing signature", (o) => { delete o.signature; }],
  ["string total", (o) => { o.fields.totalCents = "13932"; }],
];

describe("PaymentRequest schema parity (zod 3 copy vs zod 4)", () => {
  for (const [name, mutate] of variants) {
    it(name, () => {
      const o = structuredClone(valid);
      mutate(o);
      const z4 = Zod4PaymentRequest.safeParse(o).success;
      const z3 = Zod3PaymentRequest.safeParse(o).success;
      expect(z3).toBe(z4);
      expect(z4).toBe(name === "valid");
    });
  }
});
