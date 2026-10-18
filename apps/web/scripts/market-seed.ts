import { join } from "node:path";
import { getMarketDb } from "../lib/market/db.ts";
import { importAssets } from "../lib/market/seed.ts";
import { repoRoot } from "../lib/paths.ts";

const db = getMarketDb();
try {
  const added = importAssets(db, join(repoRoot(), "data", "celebrities"), Date.now());
  console.log(`Celebrity market: imported ${added} new labels at 100.000000 VU; existing prices and schedules preserved.`);
} finally { db.close(); }
