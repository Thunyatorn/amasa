import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAudit } from "@amasa/audit";
import { openDb, type Db } from "./db/index.ts";
import { getAutonomyState } from "./db/autonomy.ts";
import { unseenNotices } from "./db/notices.ts";
import { getPurchase, spentThisWeekCents } from "./db/purchases.ts";
import { seed } from "../scripts/seed.ts";

let db: Db;
beforeEach(() => { db = openDb(":memory:"); });
afterEach(() => db.close());
const kept = () => (db.prepare("SELECT count(*) AS n FROM purchases WHERE category = 'groceries' AND status = 'kept'").get() as { n: number }).n;

describe("pnpm seed (SPEC §17.3)", () => {
  it("default: 5 kept grocery orders and a level-1 offer, with one notice and an audited change", () => {
    seed(db);
    expect(kept()).toBe(5);
    expect(getAutonomyState(db, "groceries")).toMatchObject({ level: 0, offeredLevel: 1, consecutiveGood: 5 });
    expect(getPurchase(db, "SEEDGROCERY00001")?.purchase).toMatchObject({ status: "kept", category: "groceries" });
    expect(spentThisWeekCents(db, "groceries", Date.now())).toBe(0);
    expect(unseenNotices(db).map((n) => n.text)).toEqual(["You've kept 5 groceries orders in a row. You can let Amasa do more: level 1 (Propose), in Settings."]);
    seed(db);
    expect(kept()).toBe(5);
    expect(unseenNotices(db)).toHaveLength(1);
    expect(verifyAudit(db).ok).toBe(true);
  });

  it("level2: groceries at level 1 with 10 kept orders shows the level-2 offer", () => {
    seed(db);
    seed(db, "level2");
    expect(kept()).toBe(10);
    expect(getAutonomyState(db, "groceries")).toMatchObject({ level: 1, offeredLevel: 2, consecutiveGood: 5 });
    expect(unseenNotices(db).at(-1)!.text).toContain("level 2 (Prepare)");
    seed(db);
    expect(getAutonomyState(db, "groceries")).toMatchObject({ level: 0, offeredLevel: 1 });
  });
});
