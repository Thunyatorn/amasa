import { randomUUID } from "node:crypto";
import { getMarketDb } from "../lib/market/db.ts";
import { marketRuntime } from "../lib/market/runtime.ts";
import { SourceHttp } from "../lib/market/source-http.ts";
import { createEnrichmentHandler } from "../lib/market/enrichment.ts";
import { claimProfileRefresh } from "../lib/market/jobs.ts";
import { MarketScheduler } from "../lib/market/scheduler.ts";

const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--id" || !/^\d+$/.test(args[1] ?? "") || args[2] !== "--once") throw new Error("Usage: market:refresh --id 0 --once");
const runtime = marketRuntime(), db = getMarketDb();
const scheduler = new MarketScheduler(db, { workerId: `refresh:${randomUUID()}`, enrichmentConcurrency: 1,
  enrichmentHandler: createEnrichmentHandler(db, { http: new SourceHttp(db, runtime) }) });
const stop = () => { void scheduler.stop(); };
process.once("SIGTERM", stop); process.once("SIGINT", stop);
try {
  const timeout = Math.min(180_000, runtime.maxRuntimeMs), job = claimProfileRefresh(db, Number(args[1]), Date.now(), timeout + 5000);
  await scheduler.enrich(job, timeout);
  const result = db.prepare("SELECT status,error FROM market_jobs WHERE id=?").get(job.id) as { status: string; error: string | null };
  console.log(JSON.stringify({ celebrityId: job.celebrity_id, ...result }));
  if (result.status !== "done") process.exitCode = 1;
} finally { await scheduler.stop(); db.close(); }
