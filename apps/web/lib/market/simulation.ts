import { DEFAULT_CONFIG, INITIAL_MICROS, MarketConfig, nextInterval, randomWeight, seededRng } from "./config.ts";
import { priceTick } from "./pricing.ts";

type Entry = { id: number; due: number; price: number; version: number };
// Binary heap advances simulated processing time directly to the next independent event.
export function simulateMarket({ celebrities = 997, days = 3, seed = "market-simulation-v1", signals = true,
  config = DEFAULT_CONFIG }: { celebrities?: number; days?: number; seed?: string; signals?: boolean; config?: MarketConfig } = {}) {
  if (!Number.isInteger(celebrities) || celebrities < 1 || !Number.isFinite(days) || days < 0 || days > 7) throw new Error("Invalid simulation bounds");
  config = MarketConfig.parse(config);
  const heap: Entry[] = [];
  const push = (e: Entry) => {
    let i = heap.length; heap.push(e);
    while (i > 0) { const p = (i - 1) >>> 1; if (heap[p]!.due <= e.due) break; heap[i] = heap[p]!; i = p; }
    heap[i] = e;
  };
  const pop = () => {
    const first = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1]!.due < heap[child]!.due) child++;
        if (last.due <= heap[child]!.due) break;
        heap[i] = heap[child]!; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  for (let id = 0; id < celebrities; id++) push({ id, due: nextInterval(config, seededRng(seed, `seed:${id}:interval`)), price: INITIAL_MICROS, version: 1 });
  let eventCount = 0, minMicros = INITIAL_MICROS, maxMicros = INITIAL_MICROS;
  const end = days * 86_400_000;
  while (heap[0]!.due <= end) {
    const e = pop(), eventId = `price:${e.id}:${e.version}`;
    // Synthetic fixture only: a documented new +/- count change each hour, decaying to zero in
    // one hour. The real importer never creates these signals or facts.
    const normalized = (e.id % 2 ? -1 : 1) * 0.5 * (1 - (e.due % 3_600_000) / 3_600_000);
    const result = priceTick(e.price, signals ? [{ normalized, weight: randomWeight(seed, eventId, "fixture_change") }] : [], config);
    e.price = result.nextMicros;
    minMicros = Math.min(minMicros, e.price); maxMicros = Math.max(maxMicros, e.price); eventCount++;
    e.due += nextInterval(config, seededRng(seed, `${eventId}:next-interval`)); e.version++;
    push(e);
  }
  return { celebrities, days, eventCount, minMicros, maxMicros, finalTotalMicros: heap.reduce((sum, e) => sum + e.price, 0) };
}
