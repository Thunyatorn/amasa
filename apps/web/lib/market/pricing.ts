import { MarketConfig, MICROS_PER_VU } from "./config.ts";

export type Signal = { normalized: number; weight: number };
export function priceTick(previousMicros: number, signals: readonly Signal[], input: MarketConfig) {
  const config = MarketConfig.parse(input);
  if (!Number.isSafeInteger(previousMicros) || previousMicros <= 0) throw new Error("Invalid previous price");
  let sum = 0;
  for (const s of signals) {
    if (!Number.isFinite(s.normalized) || Math.abs(s.normalized) > 1
      || !Number.isFinite(s.weight) || Math.abs(s.weight) > 1) throw new Error("Invalid normalized signal or weight");
    sum += s.normalized * s.weight;
  }
  // n is the actual valid signal count, never the catalog's total feature count.
  const score = signals.length ? sum / signals.length : 0;
  const pct = config.sigma * Math.tanh(score);
  const unrounded = previousMicros * (1 + pct);
  const nextMicros = Math.round(unrounded);
  if (!Number.isFinite(unrounded) || !Number.isSafeInteger(nextMicros) || nextMicros <= 0
    || nextMicros < config.minPriceMicros || nextMicros > config.maxPriceMicros)
    throw new Error("Price circuit bound or numerical limit exceeded");
  return { previousMicros, nextMicros, score, sigma: config.sigma, pct, signalCount: signals.length };
}

export function formatVU(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("Invalid VU price");
  return `${Math.floor(micros / MICROS_PER_VU)}.${String(micros % MICROS_PER_VU).padStart(6, "0")}`;
}
