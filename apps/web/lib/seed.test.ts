import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAudit } from "@amasa/audit";
import { openDb, type Db } from "./db/index.ts";
import { getAutonomyState } from "./db/autonomy.ts";
import { unseenNotices } from "./db/notices.ts";
import { getPurchase, spentThisWeekCents } from "./db/purchases.ts";
import { applyDemoStartPrices } from "./market/demo-prices.ts";
import { INITIAL_MICROS } from "./market/config.ts";
import { loadDemoSet, seed } from "../scripts/seed.ts";

let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());
const kept = () => (db.prepare("SELECT count(*) AS n FROM purchases WHERE category = 'musicians' AND status = 'kept'").get() as { n: number }).n;
const price = (id: number) => db.prepare("SELECT initial_micros, current_micros, version FROM market_celebrities WHERE id = ?").get(id) as
  { initial_micros: number; current_micros: number; version: number } | undefined;

describe("pnpm seed (SPEC §17.3)", () => {
  it("default: 5 kept musician orders and a level-1 offer, with one notice and an audited change", () => {
    seed(db);
    expect(kept()).toBe(5);
    expect(getAutonomyState(db, "musicians")).toMatchObject({ level: 0, offeredLevel: 1, consecutiveGood: 5 });
    expect(getPurchase(db, "SEEDMUSICIAN0001")?.purchase).toMatchObject({ status: "kept", category: "musicians" });
    expect(getPurchase(db, "SEEDMUSICIAN0001")?.brands).toEqual(["Taylor Swift"]);
    expect(spentThisWeekCents(db, "musicians", Date.now())).toBe(0);
    expect(unseenNotices(db).map((n) => n.text)).toEqual(["You've kept 5 musicians orders in a row. You can let Amasa do more: level 1 (Propose), in Settings."]);
    seed(db);
    expect(kept()).toBe(5);
    expect(unseenNotices(db)).toHaveLength(1);
    expect(verifyAudit(db).ok).toBe(true);
  });

  it("level2: musicians at level 1 with 10 kept orders shows the level-2 offer", () => {
    seed(db);
    seed(db, "level2");
    expect(kept()).toBe(10);
    expect(getAutonomyState(db, "musicians")).toMatchObject({ level: 1, offeredLevel: 2, consecutiveGood: 5 });
    expect(unseenNotices(db).at(-1)!.text).toContain("level 2 (Prepare)");
    seed(db);
    expect(getAutonomyState(db, "musicians")).toMatchObject({ level: 0, offeredLevel: 1 });
  });

  it("puts every demo celebrity in the market at its starting price, and never resets a price the market moved", () => {
    seed(db);
    const set = loadDemoSet();
    for (const c of set.celebrities) expect(price(c.labelId), c.sku).toEqual({ initial_micros: c.startVU * 1_000_000, current_micros: c.startVU * 1_000_000, version: 0 });
    expect((db.prepare("SELECT count(*) AS n FROM market_celebrities").get() as { n: number }).n).toBe(set.celebrities.length);
    db.prepare("UPDATE market_celebrities SET current_micros = 300123456, version = 1 WHERE id = 914").run();
    seed(db);
    expect(price(914)).toEqual({ initial_micros: 356_000_000, current_micros: 300123456, version: 1 });
  });
});

describe("demo starting prices in the market", () => {
  it("apply only to rows still at the market's default price that the formula never moved", () => {
    seed(db);
    db.prepare("UPDATE market_celebrities SET initial_micros = ?, current_micros = ? WHERE id IN (15, 96)").run(INITIAL_MICROS, INITIAL_MICROS);
    db.prepare("UPDATE market_celebrities SET version = 2 WHERE id = 96").run();
    expect(applyDemoStartPrices(db, [{ id: 15, startVU: 272 }, { id: 96, startVU: 250 }, { id: 999_999, startVU: 100 }])).toBe(1);
    expect(price(15)).toMatchObject({ current_micros: 272_000_000 });
    expect(price(96)).toMatchObject({ current_micros: INITIAL_MICROS, version: 2 });
  });
  it("refuse a starting price outside the market's circuit bounds", () => {
    seed(db);
    expect(() => applyDemoStartPrices(db, [{ id: 15, startVU: 0 }])).toThrow(/circuit/);
  });
});
