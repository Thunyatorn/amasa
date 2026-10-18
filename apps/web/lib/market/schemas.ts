import { z } from "zod";

// Browser-safe: no Node imports or schema barrel (which also exports Node hashing).
const Epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Provenance = z.strictObject({
  sourceUrl: z.string().url(), confidence: z.number().finite().min(0).max(1),
  status: z.enum(["observed", "reported", "estimated", "derived"]),
  effectiveDate: z.iso.date().nullable(), retrievedAt: Epoch,
  publicationDate: z.iso.date().nullable().optional(),
});
export type Provenance = z.infer<typeof Provenance>;
export const Attribute = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  datatype: z.enum(["number", "count", "text", "date", "money"]),
  value: z.union([z.string().max(4000), z.number().finite()]),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  provenance: Provenance,
}).superRefine((v, ctx) => {
  if (["number", "count", "money"].includes(v.datatype) && typeof v.value !== "number")
    ctx.addIssue({ code: "custom", message: "Numeric datatype needs numeric value" });
  if (v.datatype === "count" && (typeof v.value !== "number" || !Number.isSafeInteger(v.value) || v.value < 0))
    ctx.addIssue({ code: "custom", message: "Count must be a nonnegative safe integer" });
  if (v.datatype === "money" && (!v.currency || typeof v.value !== "number" || v.value < 0))
    ctx.addIssue({ code: "custom", message: "Money needs nonnegative amount and explicit currency" });
  if (v.datatype !== "money" && v.currency) ctx.addIssue({ code: "custom", message: "Currency only applies to money" });
  if (v.datatype === "date" && !z.iso.date().safeParse(v.value).success)
    ctx.addIssue({ code: "custom", message: "Invalid attribute date" });
});
export type Attribute = z.infer<typeof Attribute>;
export const FinancialAsset = z.strictObject({
  assetId: z.string().min(1).max(120), description: z.string().min(1).max(1000),
  category: z.enum(["real_estate", "ownership", "investment", "endorsement", "other"]).default("other"),
  amount: z.number().finite().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  provenance: Provenance,
});
export type FinancialAsset = z.infer<typeof FinancialAsset>;
export const SourcePayload = z.strictObject({
  url: z.string().url(), payload: z.string().max(1_000_000), checkedAt: Epoch,
  etag: z.string().max(1000).nullable(), lastModified: z.string().max(1000).nullable(),
  retrievalUrl: z.string().url().optional(), publicationDate: z.iso.date().nullable().optional(),
});
export type SourcePayload = z.infer<typeof SourcePayload>;
export const Evidence = z.strictObject({
  key: z.string().min(1).max(120), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: z.string().max(4000), provenance: Provenance,
  entityId: z.string().regex(/^Q[1-9][0-9]*$/).optional(), factId: z.string().max(200).optional(),
});
export type Evidence = z.infer<typeof Evidence>;
export const Feature = z.strictObject({
  key: z.string().min(1).max(64), raw: z.number().finite(),
  normalized: z.number().finite().min(-1).max(1),
  changedAt: Epoch, expiresAt: Epoch, normalizationVersion: z.literal(1),
  attributeVersion: z.number().int().positive(),
});
export type Feature = z.infer<typeof Feature>;
export const Features = z.array(Feature).max(64);
export const EnrichmentResult = z.strictObject({
  attributes: z.array(Attribute).max(100), assets: z.array(FinancialAsset).max(100),
  sources: z.array(SourcePayload).max(100), evidence: z.array(Evidence).max(200),
  nextRefreshMs: z.number().int().min(60_000).max(7 * 86_400_000),
  identity: z.strictObject({ qid: z.string().regex(/^Q[1-9][0-9]*$/).nullable(), status: z.enum(["resolved", "needs_review", "pending"]),
    sourceUrls: z.array(z.string().url()).max(10), reason: z.string().max(500) }).optional(),
  aiSuccess: z.strictObject({ inputHash: z.string().regex(/^[a-f0-9]{64}$/), version: z.string().max(100), model: z.string().max(200), profession: z.enum(["performer", "athlete", "business", "writer", "other", "unknown"]) }).optional(),
}).superRefine((v, ctx) => {
  for (const [label, keys] of [["attributes", v.attributes.map((a) => a.key)], ["assets", v.assets.map((a) => a.assetId)],
    ["sources", v.sources.map((s) => s.url)], ["evidence", v.evidence.map((e) => e.key)]] as const) {
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: `Duplicate ${label} keys` });
  }
});
export type EnrichmentResult = z.infer<typeof EnrichmentResult>;
