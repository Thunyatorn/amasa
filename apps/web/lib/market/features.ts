import type { MarketConfig } from "./config.ts";
import { Attribute, Feature } from "./schemas.ts";

// Inspectable whitelist; demographics are deliberately absent. New stock observations establish
// a baseline. Only actual subsequent changes produce signals; awards/events count new increments.
export const FEATURE_CONFIG = {
  followers: { mode: "relative", logScale: Math.log(2) },
  public_mentions: { mode: "relative", logScale: Math.log(2) },
  net_worth: { mode: "relative", logScale: Math.log(2) },
  earnings: { mode: "relative", logScale: Math.log(2) },
  awards: { mode: "increment", logScale: Math.log(11) },
  career_events: { mode: "increment", logScale: Math.log(11) },
} as const;

export function changedFeature(before: Attribute | undefined, after: Attribute, version: number, now: number,
  config: MarketConfig): Feature | null {
  const a = Attribute.parse(after), b = before ? Attribute.parse(before) : undefined;
  if (!Object.hasOwn(FEATURE_CONFIG, a.key) || !b || typeof a.value !== "number" || typeof b.value !== "number"
    || a.value < 0 || b.value < 0 || a.datatype !== b.datatype || a.currency !== b.currency
    || a.value === b.value) return null;
  // Currency changes cannot be inferred as wealth changes. An FX adapter must first publish a
  // same-currency derived series with explicit provenance; phase 1 never converts currencies.
  const def = FEATURE_CONFIG[a.key as keyof typeof FEATURE_CONFIG];
  const raw = def.mode === "relative" ? Math.log1p(a.value) - Math.log1p(b.value) : a.value - b.value;
  const transformed = def.mode === "relative" ? raw / def.logScale
    : Math.sign(raw) * Math.log1p(Math.abs(raw)) / def.logScale;
  if (!a.provenance.effectiveDate && (a.key === "net_worth" || a.key === "earnings")) return null;
  const effectiveAt = a.provenance.effectiveDate ? Date.parse(`${a.provenance.effectiveDate}T00:00:00.000Z`) : now;
  // A date-only observation made today starts at observation time; old dated facts cannot be
  // replayed as fresh changes merely because a fetch happened today.
  const changedAt = Math.floor(now / 86_400_000) === Math.floor(effectiveAt / 86_400_000) ? now : Math.min(now, effectiveAt);
  return Feature.parse({ key: a.key, raw, normalized: Math.max(-1, Math.min(1, transformed)), changedAt,
    expiresAt: changedAt + config.signalWindowMs, normalizationVersion: config.normalizationVersion, attributeVersion: version });
}

export function activeFeatures(features: readonly Feature[], now: number): Feature[] {
  return features.flatMap((input) => {
    const f = Feature.parse(input);
    if (now < f.changedAt || now >= f.expiresAt || f.expiresAt <= f.changedAt) return [];
    const normalized = f.normalized * (1 - (now - f.changedAt) / (f.expiresAt - f.changedAt));
    return normalized === 0 ? [] : [{ ...f, normalized }];
  });
}
