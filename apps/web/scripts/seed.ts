import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DemoSet, ProfileEntry } from "@amasa/schemas";
import { CATEGORY_NAMES, LEVEL_NAMES } from "../lib/autonomy.ts";
import type { Db } from "../lib/db/index.ts";
import { getAutonomyState, recordAutonomyChange } from "../lib/db/autonomy.ts";
import { insertProfileEntry } from "../lib/db/profile.ts";
import { applyDemoStartPrices } from "../lib/market/demo-prices.ts";
import { migrateMarket } from "../lib/market/migrations.ts";
import { parseCsv, seedRows } from "../lib/market/seed.ts";
import { repoRoot } from "../lib/paths.ts";

// Demo data (SPEC §17.3). Fixed ids, so running it again changes nothing that is already there.
const entries = [
  { id: "a3a5a000-0000-4000-8000-000000000001", category: "musicians", key: "genre", value: "pop", source: "user_edit", status: "confirmed", note: "" },
  { id: "a3a5a000-0000-4000-8000-000000000002", category: "athletes", key: "sport", value: "tennis", source: "user_edit", status: "confirmed", note: "" },
  { id: "a3a5a000-0000-4000-8000-000000000003", category: "musicians", key: "brand_like", value: "Taylor Swift", source: "kept", status: "suggested", note: "You kept Taylor Swift twice" },
];
const DAY_MS = 86_400_000;

export type SeedVariant = "default" | "level2";

export function loadDemoSet(): DemoSet {
  return DemoSet.parse(JSON.parse(readFileSync(join(repoRoot(), "data", "celebrities", "demo-set.json"), "utf8")));
}

// The demo store's celebrities in the celebrity market, at their curated starting prices. Only the
// demo set is added here (pnpm market:seed adds all 997); a price the market already moved is kept.
export function seedMarket(db: Db, set: DemoSet, now: number): { added: number; priced: number } {
  migrateMarket(db);
  const csv = parseCsv(readFileSync(join(repoRoot(), "data", "celebrities", "metadata.csv"), "utf8")).slice(1);
  const imageCounts = new Map(csv.map((r) => [Number(r[0]), Number(r[3])] as const));
  const added = seedRows(db, set.celebrities.map((c) => ({ id: c.labelId, name: c.name, imagefile: c.imagefile, sourceImageCount: imageCounts.get(c.labelId) ?? 1 })), now);
  const priced = applyDemoStartPrices(db, set.celebrities.map((c) => ({ id: c.labelId, startVU: c.startVU })));
  return { added, priced };
}

// default: 5 kept musician orders, so musicians shows the level-1 offer. level2: musicians already at
// level 1 with 5 more kept orders (10 in all), so it shows the level-2 offer. The orders are 8+ days
// old, outside the weekly-limit window. The musicians autonomy state is set to the variant's state on
// every run (with an audit row when it changes), so the demo can be reset.
export function seed(db: Db, variant: SeedVariant = "default", now = Date.now()): void {
  const set = loadDemoSet();
  seedMarket(db, set, now);
  const musicians = set.celebrities.filter((c) => c.category === "musicians").map((c) => c.name);
  db.transaction(() => {
    for (const input of entries) {
      const entry = ProfileEntry.parse({ ...input, updatedAt: "2026-10-17T00:00:00.000Z" });
      if (!db.prepare("SELECT id FROM profile_entries WHERE id = ?").get(entry.id)) insertProfileEntry(db, entry, null);
    }
    const orders = variant === "level2" ? 10 : 5;
    for (let i = 1; i <= orders; i++) {
      const suffix = String(i).padStart(2, "0");
      db.prepare(`INSERT OR IGNORE INTO purchases (purchase_number, cart_id, contract_id, category, status, total_cents, payment_link_url, failure_codes, created_at, brands_json)
        VALUES (?, ?, ?, 'musicians', 'kept', ?, NULL, NULL, ?, ?)`)
        .run(`SEEDMUSICIAN00${suffix}`, `b3a5a000-0000-4000-8000-0000000000${suffix}`, `c3a5a000-0000-4000-8000-0000000000${suffix}`,
          15000 + i * 1100, new Date(now - (8 + i) * DAY_MS).toISOString(), JSON.stringify([musicians[(i - 1) % musicians.length]]));
    }
    const ts = new Date(now).toISOString();
    const before = getAutonomyState(db, "musicians", ts);
    const level = variant === "level2" ? 1 : 0;
    const offered = (level + 1) as 1 | 2;
    recordAutonomyChange(db, before, {
      state: { category: "musicians", level, offeredLevel: offered, consecutiveGood: 5, weeklyCapCents: before.weeklyCapCents, updatedAt: ts },
      notice: before.level === level && before.offeredLevel === offered ? null
        : `You've kept 5 ${CATEGORY_NAMES.musicians.toLowerCase()} orders in a row. You can let Amasa do more: level ${offered} (${LEVEL_NAMES[offered]}), in Settings.`,
      reason: "demo seed",
    }, ts);
  }).immediate();
}
