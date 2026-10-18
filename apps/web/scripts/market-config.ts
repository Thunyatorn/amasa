import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { getMarketDb } from "../lib/market/db.ts";
import { marketRuntime } from "../lib/market/runtime.ts";
import { MarketConfig } from "../lib/market/config.ts";
import { setMarketConfig } from "../lib/market/repository.ts";

const args = process.argv.slice(2);
if (args[0] !== "--apply" || args.length > 2) throw new Error("Usage: market:config --apply [config.json]");
let config = marketRuntime().config;
if (args[1]) {
  const path = resolve(args[1]);
  if (basename(path).startsWith(".env") || !path.endsWith(".json")) throw new Error("Configuration must be a JSON file");
  config = MarketConfig.parse(JSON.parse(readFileSync(path, "utf8")));
}
const db = getMarketDb();
try { console.log(JSON.stringify({ configHash: setMarketConfig(db, config, Date.now()) })); } finally { db.close(); }
