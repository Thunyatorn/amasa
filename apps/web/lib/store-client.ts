import { Quote, StoreListing } from "@amasa/schemas";
import { env } from "./env";
import { ApiError } from "./http";

// The agent reaches the store only over HTTP at STORE_BASE_URL (SPEC §4); every response is
// zod-parsed before use. Store text is untrusted.

const TIMEOUT_MS = 10_000;

async function call(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${env().STORE_BASE_URL}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
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
