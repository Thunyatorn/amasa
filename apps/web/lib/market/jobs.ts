import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.ts";

export interface Job {
  id: string; celebrity_id: number; kind: "price" | "enrich"; due_at: number;
  lease_token: string; lease_expires: number; attempts: number;
}
export function claimJobs(db: Db, kind: Job["kind"], now: number, limit: number, leaseMs = 30_000): Job[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isSafeInteger(leaseMs) || leaseMs < 1)
    throw new Error("Invalid job claim bounds");
  return db.transaction(() => {
    // Expiry recovery is bounded and indexed separately from ordinary due work.
    const expired = db.prepare(`SELECT id FROM market_jobs WHERE kind=? AND status='running' AND lease_expires<=?
      ORDER BY lease_expires LIMIT ?`).all(kind, now, limit) as { id: string }[];
    for (const r of expired) db.prepare(`UPDATE market_jobs SET status='retry',lease_token=NULL,lease_expires=NULL,
      retry_at=?,error='lease expired' WHERE id=? AND status='running' AND lease_expires<=?`).run(now, r.id, now);
    const rows = db.prepare(`SELECT j.id FROM market_jobs j JOIN market_celebrities c ON c.id=j.celebrity_id
      WHERE j.kind=? AND j.status IN ('pending','retry') AND j.due_at<=? AND (j.retry_at IS NULL OR j.retry_at<=?)
      AND (j.kind='enrich' OR c.status='active') ORDER BY j.due_at,j.id LIMIT ?`).all(kind, now, now, limit) as { id: string }[];
    return rows.map((r) => {
      db.prepare(`UPDATE market_jobs SET status='running',lease_token=?,lease_expires=?,attempts=attempts+1 WHERE id=?`)
        .run(randomUUID(), now + leaseMs, r.id);
      return db.prepare("SELECT * FROM market_jobs WHERE id=?").get(r.id) as Job;
    });
  }).immediate();
}
export function ownsLease(db: Db, job: Job, now: number): boolean {
  return !!db.prepare("SELECT 1 FROM market_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires>?")
    .get(job.id, job.lease_token, now);
}
// Explicit refresh claims only this entity's legitimate enrichment job. Price schedules are untouched.
export function claimProfileRefresh(db: Db, id: number, now: number, leaseMs = 180_000): Job {
  if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 1000) throw new Error("Invalid refresh bounds");
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM market_celebrities WHERE id=?").get(id)) throw new Error("Unknown market celebrity");
    let row = db.prepare("SELECT * FROM market_jobs WHERE celebrity_id=? AND kind='enrich' AND status IN ('pending','retry','running')").get(id) as Job & { status: string } | undefined;
    if (row?.status === "running" && row.lease_expires > now) throw new Error("Profile already leased");
    if (!row) {
      const jobId = `enrich:${id}:manual:${randomUUID()}`;
      db.prepare("INSERT INTO market_jobs(id,celebrity_id,kind,due_at) VALUES(?,?,'enrich',?)").run(jobId, id, now);
      row = db.prepare("SELECT * FROM market_jobs WHERE id=?").get(jobId) as Job & { status: string };
    }
    db.prepare("UPDATE market_jobs SET status='running',lease_token=?,lease_expires=?,attempts=attempts+1,retry_at=NULL WHERE id=?").run(randomUUID(), now + leaseMs, row.id);
    return db.prepare("SELECT * FROM market_jobs WHERE id=?").get(row.id) as Job;
  }).immediate();
}
export function completeJob(db: Db, job: Job, now: number): void {
  const changed = db.prepare(`UPDATE market_jobs SET status='done',lease_token=NULL,lease_expires=NULL,completed_at=?,error=NULL
    WHERE id=? AND status='running' AND lease_token=? AND lease_expires>?`).run(now, job.id, job.lease_token, now).changes;
  if (changed !== 1) throw new Error("Lost market job lease");
}
export function retryJob(db: Db, job: Job, now: number, error: string, delayMs: number): boolean {
  return db.transaction(() => {
    if (!ownsLease(db, job, now)) return false;
    db.prepare(`UPDATE market_jobs SET status='retry',lease_token=NULL,lease_expires=NULL,error=?,retry_at=? WHERE id=?`)
      .run(error.slice(0, 300), now + delayMs, job.id);
    if (job.kind === "enrich") db.prepare("UPDATE market_celebrities SET refresh_status=? WHERE id=?")
      .run(error === "ENRICHMENT_ADAPTER_UNAVAILABLE" ? "deferred" : "error", job.celebrity_id);
    return true;
  }).immediate();
}
