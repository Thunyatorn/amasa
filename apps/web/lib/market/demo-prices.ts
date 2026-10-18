import type { Db } from "../db/index.ts";
import { INITIAL_MICROS, MICROS_PER_VU } from "./config.ts";
import { marketState } from "./repository.ts";

// Celebrity pivot: the demo store's hand-picked celebrities (data/celebrities/demo-set.json) start at
// a curated price instead of the market's default. It is applied only to rows the formula has never
// priced (version 0, still at the configured initial price), so it can never reset a price the market
// has moved, and it is safe to run on every seed. Returns how many rows it changed.
export function applyDemoStartPrices(db: Db, starts: ReadonlyArray<{ id: number; startVU: number }>): number {
  return db.transaction(() => {
    const { config } = marketState(db);
    const initial = config.initialPriceMicros ?? INITIAL_MICROS;
    let changed = 0;
    for (const { id, startVU } of starts) {
      const micros = startVU * MICROS_PER_VU;
      if (!Number.isSafeInteger(micros) || micros < config.minPriceMicros || micros > config.maxPriceMicros) {
        throw new Error(`Starting price for ${id} is outside the market's circuit bounds`);
      }
      changed += db.prepare(`UPDATE market_celebrities SET initial_micros = ?, current_micros = ?
        WHERE id = ? AND version = 0 AND initial_micros = ? AND current_micros = ?`).run(micros, micros, id, initial, initial).changes;
    }
    return changed;
  }).immediate();
}
