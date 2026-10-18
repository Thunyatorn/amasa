import { z } from "zod";
import { DEFAULT_CONFIG, MarketConfig, MICROS_PER_VU } from "./config.ts";

const Runtime = z.strictObject({
  sigma: z.coerce.number().finite().gt(0).lt(1), initialPrice: z.coerce.number().finite().positive(),
  weightMin: z.coerce.number().min(-1).lt(0), weightMax: z.coerce.number().gt(0).max(1),
  concurrency: z.coerce.number().int().min(1).max(32),
  userAgent: z.string().min(16).max(300).regex(/^[\x20-\x7e]+$/),
  tmdbToken: z.string().min(1).max(1000).optional(),
  maxRuntimeMs: z.coerce.number().int().min(1000).max(86_400_000),
});
// Lazy, market-only configuration. Never log this object (it can contain a TMDB token).
export function marketRuntime(env: NodeJS.ProcessEnv = process.env) {
  const r = Runtime.parse({ sigma: env.MARKET_SIGMA ?? .0002, initialPrice: env.MARKET_INITIAL_PRICE ?? 100,
    weightMin: env.MARKET_WEIGHT_MIN ?? -1, weightMax: env.MARKET_WEIGHT_MAX ?? 1,
    concurrency: env.MARKET_REFRESH_CONCURRENCY ?? 1,
    userAgent: env.MARKET_SOURCE_USER_AGENT ?? "AmasaMarketBot/1.0 (+https://github.com/Thunyatorn/Amasa)",
    tmdbToken: env.TMDB_READ_TOKEN, maxRuntimeMs: env.MARKET_MAX_RUNTIME_MS ?? 86_400_000 });
  const config = MarketConfig.parse({ ...DEFAULT_CONFIG, sigma: r.sigma,
    ...(env.MARKET_INITIAL_PRICE ? { initialPriceMicros: r.initialPrice * MICROS_PER_VU } : {}),
    ...(env.MARKET_WEIGHT_MIN ? { weightMin: r.weightMin } : {}), ...(env.MARKET_WEIGHT_MAX ? { weightMax: r.weightMax } : {}),
    minIntervalMs: Number(env.MARKET_INTERVAL_MIN_SECONDS ?? 75) * 1000,
    maxIntervalMs: Number(env.MARKET_INTERVAL_MAX_SECONDS ?? 150) * 1000,
    minPriceMicros: Number(env.MARKET_MIN_PRICE ?? 1) * MICROS_PER_VU,
    maxPriceMicros: Number(env.MARKET_MAX_PRICE ?? 1_000_000) * MICROS_PER_VU,
    ...(env.MARKET_FEATURE_WEIGHTS ? { featureWeights: JSON.parse(env.MARKET_FEATURE_WEIGHTS) } : {}) });
  return { ...r, config, seed: env.MARKET_RANDOM_SEED,
    refreshMs: z.coerce.number().int().min(60).max(604800).parse(env.MARKET_REFRESH_SECONDS ?? 3600) * 1000,
    sourceMinIntervalMs: z.coerce.number().int().min(1000).max(60000).parse(env.MARKET_SOURCE_MIN_INTERVAL_MS ?? 1100) };
}
