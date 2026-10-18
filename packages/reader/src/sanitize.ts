import { StoreListing } from "@amasa/schemas";
import { scan } from "./scanner.ts";

// SPEC §8.2: what the planner may see of a listing. `sponsored` is removed so it neither boosts nor
// penalizes a product; it is returned separately for the UI's "Sponsored" label only.
export type PlannerListing = Omit<StoreListing, "sponsored">;

export type SanitizeResult =
  | { ok: true; listing: PlannerListing; sponsored: boolean }
  | { ok: false; sku: string | null; reason: "invalid" | "flagged"; fields: string[] };

export function sanitizeListing(raw: unknown): SanitizeResult {
  const parsed = StoreListing.safeParse(raw);
  if (!parsed.success) {
    const sku = typeof raw === "object" && raw !== null && typeof (raw as { sku?: unknown }).sku === "string"
      ? (raw as { sku: string }).sku : null;
    return { ok: false, sku, reason: "invalid", fields: [] };
  }
  const { sponsored, ...listing } = parsed.data;
  const texts: Array<[string, string]> = [["title", listing.title], ["brand", listing.brand],
    ...Object.entries(listing.attributes).filter((e): e is [string, string] => typeof e[1] === "string")
      .map(([key, value]): [string, string] => [`attributes.${key}`, value])];
  const fields = texts.filter(([, text]) => scan(text).length > 0).map(([field]) => field);
  return fields.length ? { ok: false, sku: listing.sku, reason: "flagged", fields } : { ok: true, listing, sponsored };
}
