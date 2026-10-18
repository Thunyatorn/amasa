import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Category, priceLines, Sku, type Quote, type StoreListing } from "@amasa/schemas";
import type { Catalog } from "./catalog";

// Store behavior as pure functions over the catalog (SPEC §4.2, §4.4), so it can be unit tested.

export const MAX_LIMIT = 12;

// Lowercase words; a trailing plural "s" is dropped so "actors" matches "actor".
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 0)
  .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));

// Naive keyword match on the name, category, description, attribute values, and the names of yes/no
// attributes that are "yes" (so "oscar" finds Oscar winners), filtered by category; ranked by how many
// query words match, then by SKU for a stable order.
export function search(c: Catalog, q: string, category: string | null, limit: number): StoreListing[] {
  const words = [...new Set(tokens(q))];
  const scored: Array<{ l: StoreListing; score: number }> = [];
  for (const { listing: l, page } of c.products) {
    if (category && l.category !== category) continue;
    const yes = Object.entries(l.attributes).filter(([, v]) => String(v).toLowerCase() === "yes").map(([k]) => k);
    const hay = new Set(tokens([l.title, l.brand, l.category, page.description, ...Object.values(l.attributes).map(String), ...yes].join(" ")));
    const score = words.length ? words.filter((w) => hay.has(w)).length : 1;
    if (score > 0) scored.push({ l, score });
  }
  scored.sort((a, b) => b.score - a.score || a.l.sku.localeCompare(b.l.sku));
  return scored.slice(0, Math.min(Math.max(limit, 1), MAX_LIMIT)).map((s) => s.l);
}

export const SearchParams = z.object({
  q: z.string().max(80).default(""),
  category: Category.nullable().default(null),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(MAX_LIMIT),
});

export const QuoteBody = z.strictObject({
  lines: z.array(z.strictObject({ sku: Sku, qty: z.number().int().min(1).max(10) })).min(1).max(5),
});

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; code: string; message: string };

// Authoritative price (SPEC §4.4). Duplicate SKUs are merged; unknown SKU or short stock fails.
export function quote(c: Catalog, lines: ReadonlyArray<{ sku: string; qty: number }>, now: number): QuoteResult {
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.sku, (merged.get(l.sku) ?? 0) + l.qty);
  const out: Quote["lines"] = [];
  for (const [sku, qty] of merged) {
    const listing = c.products.find((p) => p.listing.sku === sku)?.listing;
    if (!listing) return { ok: false, code: "UNKNOWN_SKU", message: `Unknown product ${sku}.` };
    if (listing.stock < qty) return { ok: false, code: "OUT_OF_STOCK", message: `Not enough stock for ${sku}.` };
    out.push({ sku, title: listing.title, qty, unitCents: listing.unitCents, lineCents: listing.unitCents * qty,
      returnDays: listing.returnDays, deliveryDays: listing.deliveryDays });
  }
  const price = priceLines(out, c);
  return {
    ok: true,
    quote: { quoteId: randomUUID(), merchant: c.merchant, currency: "USD", lines: out, ...price, quotedAt: now },
  };
}
