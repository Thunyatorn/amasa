import { z } from "zod";
import { ProductPage, Quote, StoreListing, type Category } from "@amasa/schemas";
import { env } from "./env";
import { ApiError } from "./http";

// The agent reaches the store only over HTTP at STORE_BASE_URL (SPEC §4); every response is
// zod-parsed before use. Store text is untrusted.

const TIMEOUT_MS = 10_000;

// `signal` cancels the call along with a shopping run; a cancelled call rethrows the abort.
async function call(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    return await fetch(`${env().STORE_BASE_URL}${path}`, { ...init, cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(502, "STORE_UNAVAILABLE", "The store is not responding. Please try again.");
  }
}

async function parseOrFail<T>(res: Response, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(502, "STORE_BAD_RESPONSE", "The store sent a response we could not read.");
  return parsed.data;
}

// null when the store does not know the SKU.
export async function fetchListing(sku: string): Promise<StoreListing | null> {
  const res = await call(`/products/${encodeURIComponent(sku)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(502, "STORE_UNAVAILABLE", "The store could not look up a product.");
  return parseOrFail(res, StoreListing);
}

// null when the store refuses to quote (unknown SKU or short stock): the verifier then reports
// SKU_NOT_IN_QUOTE.
export async function fetchQuote(lines: ReadonlyArray<{ sku: string; qty: number }>): Promise<Quote | null> {
  const res = await call("/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })) }),
  });
  if (res.status === 400) return null;
  if (!res.ok) throw new ApiError(502, "STORE_UNAVAILABLE", "The store could not price the cart.");
  return parseOrFail(res, Quote);
}

// SPEC §4.2. Listings come back unparsed: each one is checked on its own by the sanitizer (§8.2), so
// one malformed or flagged listing cannot hide the rest.
const SearchResult = z.strictObject({ listings: z.array(z.unknown()).max(12) });

export async function searchListings(query: string, category: Category, signal?: AbortSignal): Promise<unknown[]> {
  const params = new URLSearchParams({ q: query, category, limit: "12" });
  const res = await call(`/search?${params.toString()}`, undefined, signal);
  if (!res.ok) throw new ApiError(502, "STORE_UNAVAILABLE", "The store could not search its catalog.");
  return (await parseOrFail(res, SearchResult)).listings;
}

// SPEC §4.3. Untrusted merchant text: only the scanner and the reader ever see it. null when the
// store does not know the SKU.
export async function fetchPage(sku: string, signal?: AbortSignal): Promise<ProductPage | null> {
  const res = await call(`/products/${encodeURIComponent(sku)}/page`, undefined, signal);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(502, "STORE_UNAVAILABLE", "The store could not show a product page.");
  return parseOrFail(res, ProductPage);
}
