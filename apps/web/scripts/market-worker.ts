import { randomUUID } from "node:crypto";
import { getMarketDb } from "../lib/market/db.ts";
import { MarketScheduler } from "../lib/market/scheduler.ts";
import { marketRuntime } from "../lib/market/runtime.ts";
import { SourceHttp } from "../lib/market/source-http.ts";
import { createEnrichmentHandler } from "../lib/market/enrichment.ts";

const db = getMarketDb();
const runtime = marketRuntime();
const scheduler = new MarketScheduler(db, { workerId: `${process.pid}:${randomUUID()}`, enrichmentConcurrency: runtime.concurrency,
  enrichmentTimeoutMs: 180_000, enrichmentHandler: createEnrichmentHandler(db, { http: new SourceHttp(db, runtime) }) });
let stopping = false;
const timer = setInterval(() => {
  try { scheduler.wake(); } catch { console.error("Market worker wake failed; will retry on next wake."); }
}, 1000);
async function shutdown() {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  clearTimeout(runtimeTimer);
  await scheduler.stop(); db.close();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
const runtimeTimer = setTimeout(() => { void shutdown(); }, runtime.maxRuntimeMs);
console.log("Market worker started: independent price and cited public-profile enrichment pools.");
