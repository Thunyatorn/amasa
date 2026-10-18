import { canon, sha256 } from "@amasa/schemas";
import type { Db } from "../db/index.ts";
import { nextInterval, randomWeight, seededRng } from "./config.ts";
import { activeFeatures } from "./features.ts";
import { claimJobs, completeJob, ownsLease, retryJob, type Job } from "./jobs.ts";
import { priceTick } from "./pricing.ts";
import { celebrity, marketState, saveEnrichment, storedFeatures } from "./repository.ts";
import { EnrichmentResult } from "./schemas.ts";
import { MarketError } from "./source-http.ts";

export function processPrice(db: Db, job: Job, now: number): "applied" | "stale" | "paused" {
  if (job.kind !== "price") throw new Error("Expected price job");
  return db.transaction(() => {
    if (!ownsLease(db, job, now)) return "stale" as const;
    if (db.prepare("SELECT 1 FROM market_history WHERE event_id=?").get(job.id)) { completeJob(db, job, now); return "stale" as const; }
    const c = celebrity(db, job.celebrity_id);
    if (c.status !== "active") return "stale" as const;
    const { seed, config, configHash } = marketState(db);
    const features = activeFeatures(storedFeatures(db, c.id), now);
    const weights = features.map((f) => ({ key: f.key, weight: randomWeight(seed, job.id, f.key, config) }));
    let result: ReturnType<typeof priceTick>;
    try { result = priceTick(c.current_micros, features.map((f, i) => ({ normalized: f.normalized, weight: weights[i]!.weight })), config); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Price processing error";
      db.prepare("UPDATE market_celebrities SET status='paused',last_error=?,next_tick=NULL WHERE id=? AND version=?").run(message, c.id, c.version);
      db.prepare("UPDATE market_jobs SET status='paused',lease_token=NULL,lease_expires=NULL,error=? WHERE id=? AND lease_token=?")
        .run(message, job.id, job.lease_token);
      return "paused" as const;
    }
    const next = now + nextInterval(config, seededRng(seed, `${job.id}:next-interval`));
    const snapshot = { features, weights, config, configHash, seed, rngVersion: 1, weightVersion: c.version + 1 };
    const changed = db.prepare(`UPDATE market_celebrities SET current_micros=?,last_tick=?,next_tick=?,version=version+1,last_error=NULL
      WHERE id=? AND version=? AND status='active'`).run(result.nextMicros, now, next, c.id, c.version).changes;
    if (changed !== 1) throw new Error("Market price compare-and-swap failed");
    db.prepare(`INSERT INTO market_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(job.id, c.id, c.current_micros, result.nextMicros,
      result.score, config.sigma, result.pct, configHash, canon(snapshot), sha256(snapshot), job.due_at, now, c.version + 1);
    for (const w of weights) db.prepare(`INSERT INTO market_weights VALUES(?,?,?,?,?) ON CONFLICT(celebrity_id,feature_key)
      DO UPDATE SET value=excluded.value,version=excluded.version,event_id=excluded.event_id`).run(c.id, w.key, w.weight, c.version + 1, job.id);
    completeJob(db, job, now);
    db.prepare("INSERT INTO market_jobs(id,celebrity_id,kind,due_at) VALUES(?,?,'price',?)").run(`price:${c.id}:${c.version + 2}`, c.id, next);
    return "applied" as const;
  }).immediate();
}

export type EnrichmentHandler = (input: { celebrityId: number; jobId: string; signal: AbortSignal }) => Promise<EnrichmentResult>;
export interface SchedulerOptions {
  workerId: string; now?: () => number; priceBatch?: number; enrichmentConcurrency?: number;
  enrichmentHandler?: EnrichmentHandler; enrichmentTimeoutMs?: number;
}

// One controlled wakeup. Enrichment promises are never awaited by wake(), so model latency cannot
// hold up price claims. Each process has a bounded pool; leases coordinate the shared host DB.
export class MarketScheduler {
  private readonly now: () => number;
  private readonly pending = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  private stopped = false;
  constructor(private readonly db: Db, private readonly options: SchedulerOptions) {
    this.now = options.now ?? Date.now;
    if (!options.workerId || !Number.isInteger(options.priceBatch ?? 100) || (options.priceBatch ?? 100) < 1
      || (options.priceBatch ?? 100) > 1000 || !Number.isInteger(options.enrichmentConcurrency ?? 4)
      || (options.enrichmentConcurrency ?? 4) < 1 || (options.enrichmentConcurrency ?? 4) > 32
      || !Number.isInteger(options.enrichmentTimeoutMs ?? 120_000) || (options.enrichmentTimeoutMs ?? 120_000) < 1)
      throw new Error("Invalid scheduler bounds");
    marketState(db);
  }
  wake(): { prices: number; enrichmentInFlight: number } {
    if (this.stopped) return { prices: 0, enrichmentInFlight: this.pending.size };
    const now = this.now(); this.heartbeat("running");
    let prices = 0;
    for (const job of claimJobs(this.db, "price", now, this.options.priceBatch ?? 100)) {
      try { if (processPrice(this.db, job, this.now()) === "applied") prices++; }
      catch { retryJob(this.db, job, this.now(), "PRICE_PROCESSING_FAILED", 5000); }
    }
    const available = (this.options.enrichmentConcurrency ?? 4) - this.pending.size;
    if (available > 0) {
      const timeout = this.options.enrichmentTimeoutMs ?? 120_000;
      for (const job of claimJobs(this.db, "enrich", now, available, timeout + 5000)) {
        // Unexpected DB errors leave the lease recoverable instead of leaking an unhandled promise.
        const task = this.enrich(job, timeout).catch(() => { console.error("Market enrichment commit failed; lease will recover."); });
        this.pending.add(task);
        void task.finally(() => this.pending.delete(task));
      }
    }
    return { prices, enrichmentInFlight: this.pending.size };
  }
  async enrich(job: Job, timeoutMs: number): Promise<void> {
    if (job.kind !== "enrich") throw new Error("Expected enrichment job");
    if (!this.options.enrichmentHandler) {
      retryJob(this.db, job, this.now(), "ENRICHMENT_ADAPTER_UNAVAILABLE", 3_600_000); return;
    }
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutMs)]);
    let onAbort: (() => void) | undefined;
    try {
      // Race also bounds adapters which ignore cancellation; their late result is never committed.
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Enrichment cancelled"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      const raw = await Promise.race([this.options.enrichmentHandler({ celebrityId: job.celebrity_id, jobId: job.id, signal }), cancelled]);
      const result = EnrichmentResult.parse(raw), now = this.now();
      this.db.transaction(() => {
        if (!ownsLease(this.db, job, now) || this.stopped || signal.aborted) return;
        saveEnrichment(this.db, job.celebrity_id, result, now);
        completeJob(this.db, job, now);
        this.db.prepare("INSERT INTO market_jobs(id,celebrity_id,kind,due_at) VALUES(?,?,'enrich',?)")
          .run(`enrich:${job.celebrity_id}:${sha256({ previousJob: job.id })}`, job.celebrity_id, now + result.nextRefreshMs);
      }).immediate();
    } catch (error) {
      const code = error instanceof MarketError ? error.code : signal.aborted ? "ENRICHMENT_TIMEOUT" : "ENRICHMENT_VALIDATION_FAILED";
      retryJob(this.db, job, this.now(), code, error instanceof MarketError ? error.retryAfterMs : Math.min(3_600_000, 5000 * 2 ** Math.min(job.attempts, 9)));
    } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
  }
  private heartbeat(status: "running" | "stopped") {
    this.db.prepare(`INSERT INTO market_workers VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      heartbeat_at=excluded.heartbeat_at,status=excluded.status,json=excluded.json`)
      .run(this.options.workerId, this.now(), status, canon({ enrichmentInFlight: this.pending.size }));
  }
  async stop(): Promise<void> {
    this.stopped = true; this.abort.abort();
    await Promise.allSettled([...this.pending]);
    this.heartbeat("stopped");
  }
}
