import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, INITIAL_MICROS, MarketConfig, nextInterval, randomWeight, seededRng } from "./config.ts";
import { priceTick, formatVU } from "./pricing.ts";
import { activeFeatures, changedFeature } from "./features.ts";
import type { Attribute } from "./schemas.ts";
import { simulateMarket } from "./simulation.ts";

const C = DEFAULT_CONFIG;
const NOW = Date.parse("2026-10-18T12:00:00Z");
const attr = (value: number, over: Partial<Attribute> = {}): Attribute => ({ key: "followers", datatype: "count", value,
  provenance: { sourceUrl: "https://example.test/a", confidence: 1, status: "observed", effectiveDate: "2026-10-18", retrievedAt: NOW }, ...over });

describe("exact requested market formula", () => {
  it("matches reference vectors; n counts actual signals", () => {
    const r = priceTick(INITIAL_MICROS, [{ normalized: 1, weight: 1 }, { normalized: .5, weight: -.5 }], C);
    expect(r.score).toBe(.375);
    expect(r.nextMicros).toBe(Math.round(100_000_000 * (1 + .0002 * Math.tanh(.375))));
    expect(priceTick(INITIAL_MICROS, [], C)).toMatchObject({ score: 0, nextMicros: INITIAL_MICROS, signalCount: 0 });
    expect(priceTick(INITIAL_MICROS, [{ normalized: 1, weight: 1 }], C).nextMicros).toBe(100015232);
    expect(priceTick(INITIAL_MICROS, [{ normalized: 1, weight: -1 }], C).nextMicros).toBe(99984768);
    expect(formatVU(100015232)).toBe("100.015232");
  });
  it("rejects invalid inputs, nonfinite, overflow and circuits instead of clamping", () => {
    for (const n of [NaN, Infinity, -1, 0, .5, Number.MAX_SAFE_INTEGER + 1]) expect(() => priceTick(n, [], C)).toThrow();
    for (const v of [NaN, Infinity, -Infinity, 1.001, -1.001]) {
      expect(() => priceTick(INITIAL_MICROS, [{ normalized: v, weight: 1 }], C)).toThrow();
      expect(() => priceTick(INITIAL_MICROS, [{ normalized: 1, weight: v }], C)).toThrow();
    }
    for (const sigma of [0, 1, NaN, -.1]) expect(() => priceTick(INITIAL_MICROS, [], { ...C, sigma })).toThrow();
    expect(() => priceTick(Number.MAX_SAFE_INTEGER, [{ normalized: 1, weight: 1 }], { ...C, maxPriceMicros: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(() => priceTick(INITIAL_MICROS, [{ normalized: 1, weight: 1 }], { ...C, maxPriceMicros: INITIAL_MICROS })).toThrow();
    expect(() => priceTick(1, [{ normalized: 1, weight: -1 }], { ...C, minPriceMicros: 1, sigma: .999 })).toThrow();
  });
  it("bounds movement, preserves positivity and compounds from the previous rounded price", () => {
    let p = INITIAL_MICROS;
    const rng = seededRng("properties", "math");
    for (let i = 0; i < 10_000; i++) {
      const normalized = rng() * 2 - 1, weight = rng() * 2 - 1;
      const r = priceTick(p, [{ normalized, weight }], C);
      expect(Math.abs(r.pct)).toBeLessThanOrEqual(C.sigma * Math.tanh(1));
      expect(r.nextMicros).toBe(Math.round(p * (1 + C.sigma * Math.tanh(normalized * weight))));
      expect(r.nextMicros).toBeGreaterThan(0); p = r.nextMicros;
    }
    let actual = INITIAL_MICROS, expected = INITIAL_MICROS;
    for (let i = 0; i < 48; i++) {
      actual = priceTick(actual, [{ normalized: 1, weight: 1 }], C).nextMicros;
      expected = Math.round(expected * (1 + C.sigma * Math.tanh(1)));
    }
    expect(actual).toBe(expected);
    expect(priceTick(1, [], { ...C, minPriceMicros: 1 }).nextMicros).toBe(1);
  });
});

describe("seeded backend randomness and normalization", () => {
  it("enforces intervals and deterministic bounded signed weights", () => {
    const rng = seededRng("seed", "intervals"); let total = 0;
    for (let i = 0; i < 10_000; i++) {
      const interval = nextInterval(C, rng), weight = randomWeight("seed", `event:${i}`, "followers");
      expect(interval).toBeGreaterThanOrEqual(75_000); expect(interval).toBeLessThanOrEqual(150_000);
      expect(weight).toBe(randomWeight("seed", `event:${i}`, "followers"));
      expect(Math.abs(weight)).toBeLessThanOrEqual(1); total += weight;
    }
    expect(Math.abs(total / 10_000)).toBeLessThan(.025);
    expect(randomWeight("seed", "event", "a")).not.toBe(randomWeight("seed", "event", "b"));
    expect(nextInterval(C, () => 0)).toBe(75_000); expect(nextInterval(C, () => 1 - Number.EPSILON)).toBe(150_000);
    expect(() => nextInterval(C, () => 1)).toThrow();
    expect(MarketConfig.safeParse({ ...C, minIntervalMs: 74999 }).success).toBe(false);
    expect(MarketConfig.safeParse({ ...C, maxIntervalMs: 150001 }).success).toBe(false);
  });
  it("omits missing/unchanged/demographic/unsupported-currency signals and decays changes to zero", () => {
    expect(changedFeature(undefined, attr(100), 1, NOW, C)).toBeNull();
    expect(changedFeature(attr(100), attr(100), 2, NOW, C)).toBeNull();
    for (const key of ["age", "nationality", "birthplace"]) expect(changedFeature(attr(10, { key }), attr(20, { key }), 2, NOW, C)).toBeNull();
    expect(changedFeature(attr(10, { key: "earnings", datatype: "money", currency: "USD" }), attr(20, { key: "earnings", datatype: "money", currency: "EUR" }), 2, NOW, C)).toBeNull();
    const f = changedFeature(attr(100), attr(200), 2, NOW, C)!;
    expect(f.normalized).toBeGreaterThan(0); expect(f.normalized).toBeLessThanOrEqual(1);
    expect(activeFeatures([f], NOW + 1_800_000)[0]!.normalized).toBeCloseTo(f.normalized / 2);
    expect(activeFeatures([f], NOW + 3_600_000)).toEqual([]);
    expect(changedFeature(attr(200), attr(100), 3, NOW, C)!.normalized).toBeLessThan(0);
    expect(changedFeature(attr(1, { key: "awards" }), attr(11, { key: "awards" }), 2, NOW, C)!.normalized).toBe(1);
  });
});

it("simulates >=997 independent celebrities for three days with production math and intervals", () => {
  const start = performance.now(), result = simulateMarket();
  console.info("market simulation", { ...result, runtimeMs: Math.round(performance.now() - start) });
  expect(result.eventCount).toBeGreaterThan(997 * 3 * 86_400 / 150 - 997);
  expect(result.eventCount).toBeLessThan(997 * 3 * 86_400 / 75);
  expect(result.minMicros).toBeGreaterThanOrEqual(C.minPriceMicros);
  expect(result.maxMicros).toBeLessThanOrEqual(C.maxPriceMicros);
  expect(simulateMarket({ celebrities: 20, days: .01 })).toEqual(simulateMarket({ celebrities: 20, days: .01 }));
  expect(simulateMarket({ celebrities: 997, days: .01, signals: false })).toMatchObject({ minMicros: INITIAL_MICROS, maxMicros: INITIAL_MICROS });
}, 120_000);
