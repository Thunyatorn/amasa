import { canon, sha256 } from "@amasa/schemas";
import { Attribute, type EnrichmentResult, type FinancialAsset } from "./schemas.ts";
import { factCatalog } from "./wikidata.ts";

const PUBLIC_KEYS = new Set(["birth_date", "birth_date_precision", "aliases", "nationality", "birthplace", "occupations", "industry", "employers", "affiliations", "sports_teams", "awards", "awards_list", "notable_works", "career", "career_events", "filmography", "official_urls", "twitter_handles", "instagram_handles", "youtube_channels", "tmdb_person_id", "followers", "public_mentions", "net_worth", "earnings", "net_worth_references", "followers_references"]);
export function validateGrounding(result: EnrichmentResult, qid: string | null, now: number): void {
  const sources = new Map(result.sources.map(s => [s.url, s]));
  const catalog = qid ? factCatalog(qid, result.sources) : [];
  const today = new Date(now).toISOString().slice(0, 10);
  for (const value of [...result.attributes, ...result.assets]) {
    const key = "key" in value ? value.key : value.assetId;
    if ("key" in value && !PUBLIC_KEYS.has(key)) throw new Error("UNSUPPORTED_ATTRIBUTE");
    const e = result.evidence.find(v => v.key === key), s = sources.get(value.provenance.sourceUrl);
    if (!e || !s || e.sourceHash !== sha256({ payload: s.payload }) || !e.excerpt.trim() || !s.payload.includes(e.excerpt)
      || canon(e.provenance) !== canon(value.provenance) || e.provenance.retrievedAt !== s.checkedAt
      || s.checkedAt > now || value.provenance.effectiveDate && value.provenance.effectiveDate > today
      || value.provenance.publicationDate && value.provenance.publicationDate > today)
      throw new Error("EVIDENCE_NOT_GROUNDED");
    if (qid && e.entityId !== qid) throw new Error("EVIDENCE_ENTITY_MISMATCH");
    if (e.factId) {
      const fact = catalog.find(v => v.id === e.factId);
      if (!fact || !("key" in value) || canon(fact.attribute) !== canon(value) || canon(fact.evidence) !== canon(e)) throw new Error("CATALOG_VALUE_MISMATCH");
      continue;
    }
    if ("key" in value) {
      // Prose facts are deliberately restricted. No AI-derived demographic or count/finance
      // aggregate may masquerade as a typed Wikidata fact.
      if (qid && !["career", "industry", "filmography", "net_worth", "earnings"].includes(value.key)) throw new Error("CATALOG_FACT_REQUIRED");
      if (value.provenance.status === "derived" || value.datatype === "text" && !e.excerpt.includes(String(value.value))) throw new Error("UNSUPPORTED_PROSE_VALUE");
      if (typeof value.value === "number" && !groundedNumber(value.value, value.currency ?? null, e.excerpt)) throw new Error("UNSUPPORTED_NUMERIC_VALUE");
    } else validateAsset(value, e.excerpt);
  }
  for (const e of result.evidence) {
    const s = sources.get(e.provenance.sourceUrl);
    if (!s || e.sourceHash !== sha256({ payload: s.payload }) || !e.excerpt.trim() || !s.payload.includes(e.excerpt)) throw new Error("EVIDENCE_NOT_GROUNDED");
  }
}
export function groundedNumber(amount: number, currency: string | null, quote: string): boolean {
  // A currency symbol alone is ambiguous except explicit US$. Never infer USD from "$".
  const money = /\b(USD|EUR|GBP|JPY)\s*([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)?\b/g;
  if (currency) return [...quote.matchAll(money)].some(m => m[1] === currency && Number(m[2]!.replaceAll(",", "")) * ({ billion: 1e9, million: 1e6, thousand: 1e3 }[m[3] ?? ""] ?? 1) === amount);
  return [...quote.matchAll(/(?:^|[^\d.])([\d,]+(?:\.\d+)?)(?![\d.])/g)].some(m => Number(m[1]!.replaceAll(",", "")) === amount);
}
function validateAsset(asset: FinancialAsset, quote: string) {
  if (!quote.includes(asset.description) || asset.provenance.status === "derived"
    || asset.amount !== null && (!asset.currency || !groundedNumber(asset.amount, asset.currency, quote))
    || asset.amount === null && asset.currency !== null) throw new Error("UNSUPPORTED_ASSET_VALUE");
}
