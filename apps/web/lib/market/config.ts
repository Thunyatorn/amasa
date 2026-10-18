import { z } from "zod";

export const MICROS_PER_VU = 1_000_000;
export const INITIAL_MICROS = 100 * MICROS_PER_VU;
const WeightBounds = z.strictObject({ min: z.number().finite().min(-1).max(0), max: z.number().finite().min(0).max(1), multiplier: z.number().finite().min(0).max(1).default(1) }).refine(v => v.min < v.max);
export const MarketConfig = z.strictObject({
  version: z.literal(1),
  sigma: z.number().finite().gt(0).lt(1),
  minIntervalMs: z.number().int().min(75_000).max(150_000),
  maxIntervalMs: z.number().int().min(75_000).max(150_000),
  signalWindowMs: z.number().int().positive().max(86_400_000),
  minPriceMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxPriceMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  normalizationVersion: z.literal(1),
  initialPriceMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  weightMin: z.number().finite().min(-1).lt(0).optional(),
  weightMax: z.number().finite().gt(0).max(1).optional(),
  featureWeights: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), WeightBounds).optional(),
}).refine((v) => v.minIntervalMs <= v.maxIntervalMs && v.minPriceMicros <= (v.initialPriceMicros ?? INITIAL_MICROS)
  && v.maxPriceMicros >= (v.initialPriceMicros ?? INITIAL_MICROS), "Invalid interval or circuit bounds");
export type MarketConfig = z.infer<typeof MarketConfig>;
export const DEFAULT_CONFIG: MarketConfig = {
  version: 1, sigma: 0.0002, minIntervalMs: 75_000, maxIntervalMs: 150_000,
  signalWindowMs: 3_600_000, minPriceMicros: 1_000_000, maxPriceMicros: 1_000_000_000_000,
  normalizationVersion: 1,
};

// Backend-only, reproducible non-cryptographic RNG. Context separates every entity/event/purpose.
// Records use canon/sha256; this integer mixer is solely an RNG, never an audit hash.
export function seededRng(seed: string, context: string): () => number {
  let state = 2166136261;
  for (const c of `${seed.length}:${seed}:${context}`) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextInterval(config: MarketConfig, random: () => number): number {
  const c = MarketConfig.parse(config), u = random();
  if (!Number.isFinite(u) || u < 0 || u >= 1) throw new Error("Invalid backend RNG sample");
  return c.minIntervalMs + Math.floor(u * (c.maxIntervalMs - c.minIntervalMs + 1));
}

export function randomWeight(seed: string, eventId: string, feature: string, config: MarketConfig = DEFAULT_CONFIG): number {
  // Symmetric discrete support includes both endpoints and has exactly zero theoretical mean.
  const c = config, bounds = c.featureWeights?.[feature];
  const min = bounds?.min ?? c.weightMin ?? -1, max = bounds?.max ?? c.weightMax ?? 1;
  const u = Math.floor(seededRng(seed, `${eventId}:weight:${feature}`)() * 2_000_001) / 2_000_000;
  return (min + u * (max - min)) * (bounds?.multiplier ?? 1);
}
