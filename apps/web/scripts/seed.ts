import { ProfileEntry } from "@amasa/schemas";
import { CATEGORY_NAMES, LEVEL_NAMES } from "../lib/autonomy.ts";
import type { Db } from "../lib/db/index.ts";
import { getAutonomyState, recordAutonomyChange } from "../lib/db/autonomy.ts";
import { insertProfileEntry } from "../lib/db/profile.ts";

// Demo data (SPEC §17.3). Fixed ids, so running it again changes nothing that is already there.
const entries = [
  { id: "a3a5a000-0000-4000-8000-000000000001", key: "size", value: 10.5, source: "user_edit", status: "confirmed", note: "" },
  { id: "a3a5a000-0000-4000-8000-000000000002", key: "width", value: "wide", source: "user_edit", status: "confirmed", note: "" },
  { id: "a3a5a000-0000-4000-8000-000000000003", key: "brand_like", value: "Stride", source: "kept", status: "suggested", note: "You kept Stride shoes twice" },
];
const BRANDS = ["Harvest Field", "Green Valley", "Sunny Grove", "Hillside Farm", "Baker's Lane"];
const DAY_MS = 86_400_000;

export type SeedVariant = "default" | "level2";

// default: 5 kept grocery orders, so groceries shows the level-1 offer. level2: groceries already at
// level 1 with 5 more kept orders (10 in all), so it shows the level-2 offer. The orders are 8+ days
// old, outside the weekly-limit window. The groceries autonomy state is set to the variant's state on
// every run (with an audit row when it changes), so the demo can be reset.
export function seed(db: Db, variant: SeedVariant = "default", now = Date.now()): void {
  db.transaction(() => {
    for (const input of entries) {
      const entry = ProfileEntry.parse({ ...input, category: "running-shoes", updatedAt: "2026-10-17T00:00:00.000Z" });
      if (!db.prepare("SELECT id FROM profile_entries WHERE id = ?").get(entry.id)) insertProfileEntry(db, entry, null);
    }
    const orders = variant === "level2" ? 10 : 5;
    for (let i = 1; i <= orders; i++) {
      const suffix = String(i).padStart(2, "0");
      db.prepare(`INSERT OR IGNORE INTO purchases (purchase_number, cart_id, contract_id, category, status, total_cents, payment_link_url, failure_codes, created_at, brands_json)
        VALUES (?, ?, ?, 'groceries', 'kept', ?, NULL, NULL, ?, ?)`)
        .run(`SEEDGROCERY000${suffix}`, `b3a5a000-0000-4000-8000-0000000000${suffix}`, `c3a5a000-0000-4000-8000-0000000000${suffix}`,
          1100 + i * 37, new Date(now - (8 + i) * DAY_MS).toISOString(), JSON.stringify([BRANDS[(i - 1) % BRANDS.length]]));
    }
    const ts = new Date(now).toISOString();
    const before = getAutonomyState(db, "groceries", ts);
    const level = variant === "level2" ? 1 : 0;
    const offered = (level + 1) as 1 | 2;
    recordAutonomyChange(db, before, {
      state: { category: "groceries", level, offeredLevel: offered, consecutiveGood: 5, weeklyCapCents: before.weeklyCapCents, updatedAt: ts },
      notice: before.level === level && before.offeredLevel === offered ? null
        : `You've kept 5 ${CATEGORY_NAMES.groceries.toLowerCase()} orders in a row. You can let Amasa do more: level ${offered} (${LEVEL_NAMES[offered]}), in Settings.`,
      reason: "demo seed",
    }, ts);
  }).immediate();
}
