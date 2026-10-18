import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { canon, sha256 } from "@amasa/schemas";
import type { Db } from "../db/index.ts";
import { repoRoot } from "../paths.ts";
import { DEFAULT_CONFIG, INITIAL_MICROS } from "./config.ts";
import { openMarketDb } from "./db.ts";
import { migrateMarket } from "./migrations.ts";
import { claimJobs, ownsLease, retryJob } from "./jobs.ts";
import { priceTick } from "./pricing.ts";
import { assignQid, celebrity, marketState, reserveHost, saveEnrichment, setMarketConfig, storedFeatures } from "./repository.ts";
import { MarketScheduler, processPrice } from "./scheduler.ts";
import { importAssets, parseCsv, seedRows } from "./seed.ts";
import type { Attribute, EnrichmentResult } from "./schemas.ts";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const dbs: Db[] = [], dirs: string[] = [];
const open = (path = ":memory:") => { const db = openMarketDb(path); dbs.push(db); return db; };
const tempPath = () => { const dir = mkdtempSync(join(tmpdir(), "amasa-market-")); dirs.push(dir); return join(dir, "test.db"); };
const rows = (n = 3) => Array.from({ length: n }, (_, id) => ({ id, name: `Celebrity ${id}`, imagefile: `${id}_Celebrity_${id}.jpg`, sourceImageCount: 10 }));
const setup = (n = 3, path?: string) => { const db = open(path); seedRows(db, rows(n), NOW, "test-seed"); return db; };
const count = (db: Db, table: string) => (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
const attribute = (value: number, retrievedAt = NOW): Attribute => ({ key: "followers", datatype: "count", value,
  provenance: { sourceUrl: "https://evidence.test/profile", confidence: .9, status: "reported", effectiveDate: "2026-10-18", retrievedAt } });
const enrichment = (value: number, now = NOW): EnrichmentResult => ({ attributes: [attribute(value, now)], assets: [],
  sources: [{ url: "https://evidence.test/profile", payload: `followers: ${value}`, checkedAt: now, etag: "v1", lastModified: null }],
  evidence: [{ key: "followers", sourceHash: sha256({ payload: `followers: ${value}` }), excerpt: `followers: ${value}`, provenance: attribute(value, now).provenance }], nextRefreshMs: 3_600_000 });
afterEach(() => { for (const db of dbs.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("additive schema and assets", () => {
  it("migrates idempotently, keeps shopping data, enables FK/constraints and versions the ledger", () => {
    const db = open(); db.prepare("INSERT INTO contracts VALUES('existing','{}','hash','now')").run();
    migrateMarket(db); migrateMarket(db);
    expect(count(db, "market_migrations")).toBe(2); expect(count(db, "contracts")).toBe(1);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => db.prepare("INSERT INTO market_jobs(id,celebrity_id,kind,due_at) VALUES('x',999,'price',0)").run()).toThrow();
    seedRows(db, rows(), NOW, "seed");
    expect(() => db.prepare("UPDATE market_celebrities SET current_micros=0 WHERE id=0").run()).toThrow();
    expect(() => db.prepare("UPDATE market_celebrities SET current_micros=1.5 WHERE id=0").run()).toThrow();
    expect(() => db.prepare("UPDATE market_jobs SET status='running' WHERE id='price:0:1'").run()).toThrow();
  });
  it("parses quoted CSV names and rejects malformed input", () => {
    expect(parseCsv('a,b\r\n1,"Dwayne ""The Rock"" Johnson"\r\n2,"name, extra"\n')).toEqual([
      ["a", "b"], ["1", 'Dwayne "The Rock" Johnson'], ["2", "name, extra"]]);
    expect(parseCsv('"line\nname",x')).toEqual([["line\nname", "x"]]);
    expect(() => parseCsv('a,"open')).toThrow(); expect(() => parseCsv('"a"x,b')).toThrow();
  });
  it("imports all 997 checked asset labels into a temporary database, preserving existing schedules/prices", () => {
    const db = open(), dir = join(repoRoot(), "data", "celebrities");
    expect(importAssets(db, dir, NOW, "assets")).toBe(997);
    expect(count(db, "market_celebrities")).toBe(997); expect(count(db, "market_jobs")).toBe(1994);
    expect(count(db, "market_attributes")).toBe(0); expect(count(db, "market_assets")).toBe(0);
    const before = celebrity(db, 0);
    db.prepare("UPDATE market_celebrities SET current_micros=123456789 WHERE id=0").run();
    expect(importAssets(db, dir, NOW + 86_400_000, "different-seed")).toBe(0);
    expect(celebrity(db, 0)).toMatchObject({ current_micros: 123456789, next_tick: before.next_tick });
    expect(marketState(db).seed).toBe("assets");
    expect(new Set((db.prepare("SELECT next_tick FROM market_celebrities").all() as { next_tick: number }[]).map((r) => r.next_tick)).size).toBeGreaterThan(900);
    expect(() => importAssets(db, dir, NOW, "seed", 1000)).toThrow();
  });
  it("handles canonical QID conflicts explicitly without duplicate assignments", () => {
    const db = setup();
    expect(assignQid(db, 0, "Q123")).toBe("resolved");
    expect(assignQid(db, 1, "Q123")).toBe("needs_review");
    expect(db.prepare("SELECT qid,alias_of,identity_status FROM market_celebrities WHERE id=1").get()).toEqual({ qid: null, alias_of: 0, identity_status: "needs_review" });
    expect(() => db.prepare("UPDATE market_celebrities SET qid='Q123' WHERE id=2").run()).toThrow();
    expect(() => assignQid(db, 2, "Q1oops")).toThrow();
    expect(() => seedRows(db, [{ ...rows()[0]!, name: "Conflict" }], NOW)).toThrow();
  });
});

describe("provenance, immutable changes and feature aging", () => {
  it("records baselines but no invented signal; unchanged fetches do not renew changes or snapshots", () => {
    const db = setup();
    saveEnrichment(db, 0, enrichment(100), NOW);
    expect(storedFeatures(db, 0)).toEqual([]);
    saveEnrichment(db, 0, enrichment(200, NOW + 1000), NOW + 1000);
    const features = storedFeatures(db, 0), changes = count(db, "market_attribute_changes"), snapshots = count(db, "market_snapshots");
    expect(features).toHaveLength(1);
    saveEnrichment(db, 0, enrichment(200, NOW + 5000), NOW + 5000);
    expect(storedFeatures(db, 0)).toEqual(features);
    expect(count(db, "market_attribute_changes")).toBe(changes); expect(count(db, "market_snapshots")).toBe(snapshots);
    expect((db.prepare("SELECT checked_at FROM market_sources").get() as { checked_at: number }).checked_at).toBe(NOW + 5000);
    expect(() => db.prepare("UPDATE market_attribute_changes SET hash='bad'").run()).toThrow();
    expect(() => db.prepare("DELETE FROM market_snapshots").run()).toThrow();
    expect(() => saveEnrichment(db, 0, { ...enrichment(300), evidence: [{ ...enrichment(300).evidence[0]!, sourceHash: "0".repeat(64) }] }, NOW)).toThrow();
    expect(storedFeatures(db, 0)).toEqual(features); // failed provenance rolls back all writes
    const snapshot = db.prepare("SELECT json,hash FROM market_snapshots LIMIT 1").get() as { json: string; hash: string };
    expect(sha256(JSON.parse(snapshot.json))).toBe(snapshot.hash);
  });
  it("retains financial currency/type/date and never converts or prices demographics", () => {
    const db = setup(), input = enrichment(100);
    // Demographic keys are not on the public whitelist, so they are refused outright.
    expect(() => saveEnrichment(db, 0, { ...input, attributes: [{ ...attribute(45), key: "age" }] }, NOW)).toThrow("UNSUPPORTED_ATTRIBUTE");
    expect(count(db, "market_attributes")).toBe(0);
    const payload = "Net worth: EUR 1,000,000. Reported property estimate: EUR 2,000,000.";
    const source = { url: "https://evidence.test/profile", payload, checkedAt: NOW, etag: "v1", lastModified: null };
    const provenance = attribute(0).provenance, estimated = { ...provenance, status: "estimated" as const };
    const asset = { assetId: "reported-home", description: "Reported property estimate", category: "real_estate" as const, amount: 2_000_000, currency: "EUR", provenance: estimated };
    saveEnrichment(db, 0, { ...input, sources: [source], attributes: [{ ...attribute(1_000_000), key: "net_worth", datatype: "money", currency: "EUR" }], assets: [asset],
      evidence: [{ key: "net_worth", sourceHash: sha256({ payload }), excerpt: "Net worth: EUR 1,000,000.", provenance },
        { key: "reported-home", sourceHash: sha256({ payload }), excerpt: "Reported property estimate: EUR 2,000,000.", provenance: estimated }] }, NOW);
    expect(storedFeatures(db, 0)).toEqual([]);
    expect(JSON.parse((db.prepare("SELECT json FROM market_assets").get() as { json: string }).json)).toEqual(asset);
    expect(() => saveEnrichment(db, 0, { ...input, attributes: [{ ...attribute(1), datatype: "money" }] }, NOW)).toThrow();
  });
});

describe("durable claims, fencing, history and restart", () => {
  it("two independent Node processes contend safely for the same shared-file batch", async () => {
    const path = tempPath(), db = setup(20, path), now = NOW + 150_000;
    const script = `import { openMarketDb } from './lib/market/db.ts';
      import { claimJobs } from './lib/market/jobs.ts';
      import { processPrice } from './lib/market/scheduler.ts';
      const db=openMarketDb(process.argv[1]);
      const jobs=claimJobs(db,'price',${now},20);
      for(const j of jobs) processPrice(db,j,${now});
      console.log(JSON.stringify(jobs.map(j=>j.id))); db.close();`;
    const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script, path], { cwd: join(repoRoot(), "apps/web") });
    const output = await Promise.all([run(), run()]);
    const ids = output.flatMap((r) => JSON.parse(r.stdout) as string[]);
    expect(ids).toHaveLength(20); expect(new Set(ids).size).toBe(20);
    expect(count(db, "market_history")).toBe(20);
  });
  it("two shared-file connections cannot claim or apply the same event twice; expired leases recover", () => {
    const path = tempPath(), a = setup(3, path), b = open(path), time = NOW + 150_000;
    const first = claimJobs(a, "price", time, 1, 1000)[0]!;
    const second = claimJobs(b, "price", time, 1, 1000)[0]!;
    expect(second.id).not.toBe(first.id);
    expect(ownsLease(a, first, time + 1000)).toBe(false);
    expect(processPrice(a, first, time + 1000)).toBe("stale");
    const recovered = claimJobs(b, "price", time + 1001, 3, 30_000);
    const replacement = recovered.find((j) => j.id === first.id)!;
    expect(replacement.lease_token).not.toBe(first.lease_token); expect(replacement.attempts).toBe(2);
    expect(retryJob(a, first, time + 1002, "stale failure", 1)).toBe(false);
    expect(processPrice(b, replacement, time + 1002)).toBe("applied");
    expect(processPrice(a, first, time + 1003)).toBe("stale");
    expect(processPrice(b, replacement, time + 1003)).toBe("stale");
    expect(count(a, "market_history")).toBe(1);
    expect(celebrity(a, replacement.celebrity_id)).toMatchObject({ current_micros: INITIAL_MICROS, version: 1, last_tick: time + 1002 });
    const pending = a.prepare("SELECT due_at FROM market_jobs WHERE celebrity_id=? AND kind='price' AND status='pending'").get(replacement.celebrity_id) as { due_at: number };
    expect(pending.due_at - time - 1002).toBeGreaterThanOrEqual(75_000);
  });
  it("persists history/config/weights for exact replay across config changes and restart", () => {
    const path = tempPath(), db = setup(3, path);
    for (let id = 0; id < 3; id++) { saveEnrichment(db, id, enrichment(100), NOW); saveEnrichment(db, id, enrichment(200, NOW + 1), NOW + 1); }
    for (let minute = 3; minute <= 60; minute += 3) {
      const time = NOW + minute * 60_000;
      for (const job of claimJobs(db, "price", time, 10)) expect(processPrice(db, job, time)).toBe("applied");
      if (minute === 30) setMarketConfig(db, { ...DEFAULT_CONFIG, sigma: .0003 }, time);
    }
    const history = db.prepare("SELECT * FROM market_history ORDER BY celebrity_id,version").all() as {
      previous_micros: number; new_micros: number; score: number; snapshot_json: string; snapshot_hash: string; config_hash: string;
    }[];
    expect(history).toHaveLength(60); expect(count(db, "market_weights")).toBe(3);
    for (const row of history) {
      const snapshot = JSON.parse(row.snapshot_json);
      expect(sha256(snapshot)).toBe(row.snapshot_hash); expect(sha256(snapshot.config)).toBe(row.config_hash);
      const replay = priceTick(row.previous_micros, snapshot.features.map((f: { normalized: number }, i: number) => ({ normalized: f.normalized, weight: snapshot.weights[i].weight })), snapshot.config);
      expect(replay.nextMicros).toBe(row.new_micros); expect(replay.score).toBe(row.score);
    }
    const before = celebrity(db, 0); db.close();
    const restarted = open(path);
    expect(celebrity(restarted, 0)).toEqual(before);
    const muchLater = NOW + 7 * 86_400_000;
    expect(claimJobs(restarted, "price", muchLater, 10)).toHaveLength(3); // one overdue job/entity
    expect(() => restarted.prepare("DELETE FROM market_history").run()).toThrow();
    expect(() => restarted.prepare("INSERT INTO market_history SELECT * FROM market_history LIMIT 1").run()).toThrow();
  });
  it("pauses an out-of-bounds result, retains its price, and persists failure", () => {
    const db = setup(1); saveEnrichment(db, 0, enrichment(100), NOW); saveEnrichment(db, 0, enrichment(200, NOW + 1), NOW + 1);
    setMarketConfig(db, { ...DEFAULT_CONFIG, minPriceMicros: INITIAL_MICROS, maxPriceMicros: INITIAL_MICROS }, NOW);
    const job = claimJobs(db, "price", NOW + 150_000, 1)[0]!;
    expect(processPrice(db, job, NOW + 150_000)).toBe("paused");
    expect(celebrity(db, 0)).toMatchObject({ current_micros: INITIAL_MICROS, status: "paused", next_tick: null });
    expect(count(db, "market_history")).toBe(0);
    expect(db.prepare("SELECT status,error FROM market_jobs WHERE id=?").get(job.id)).toMatchObject({ status: "paused", error: expect.stringContaining("circuit") });
  });
  it("host slots persist and coordinate two connections", () => {
    const path = tempPath(), a = setup(1, path), b = open(path);
    expect(reserveHost(a, "example.test", NOW, 1000)).toBe(true);
    expect(reserveHost(b, "example.test", NOW, 1000)).toBe(false);
    expect(reserveHost(b, "example.test", NOW + 1000, 1000)).toBe(true);
  });
});

describe("independent worker pools", () => {
  it("keeps hourly price scheduling alive while enrichment is slow and shuts down gracefully", async () => {
    const db = setup(3); let time = NOW;
    const worker = new MarketScheduler(db, { workerId: "slow-worker", now: () => time, enrichmentConcurrency: 1,
      enrichmentHandler: async ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })) });
    worker.wake();
    for (let i = 1; i <= 3600; i++) { time = NOW + i * 1000; worker.wake(); }
    expect(count(db, "market_history")).toBeGreaterThanOrEqual(3 * 23);
    expect(count(db, "market_history")).toBeLessThanOrEqual(3 * 48);
    expect((db.prepare("SELECT count(*) n FROM market_jobs WHERE kind='enrich' AND status='running'").get() as { n: number }).n).toBe(1);
    await worker.stop();
    expect(db.prepare("SELECT status FROM market_workers WHERE id='slow-worker'").get()).toEqual({ status: "stopped" });
    expect(worker.wake().prices).toBe(0);
  });
  it("defers missing adapters and retries errors, never recording fake refresh success", async () => {
    const db = setup(1); let time = NOW;
    const worker = new MarketScheduler(db, { workerId: "no-adapter", now: () => time });
    worker.wake(); await Promise.resolve();
    expect(db.prepare("SELECT refresh_status,last_refresh FROM market_celebrities").get()).toEqual({ refresh_status: "deferred", last_refresh: null });
    expect(db.prepare("SELECT status,error,retry_at FROM market_jobs WHERE kind='enrich'").get()).toMatchObject({ status: "retry", error: "ENRICHMENT_ADAPTER_UNAVAILABLE", retry_at: NOW + 3_600_000 });
    await worker.stop(); time += 3_600_000;
    const next = new MarketScheduler(db, { workerId: "error-adapter", now: () => time, enrichmentHandler: async () => { throw new Error("unavailable"); } });
    next.wake(); await new Promise((resolve) => setImmediate(resolve));
    expect(db.prepare("SELECT refresh_status FROM market_celebrities").get()).toEqual({ refresh_status: "error" });
    expect(celebrity(db, 0).last_tick).toBe(time); await next.stop();
  });
  it("commits valid injected enrichment atomically and fences a late adapter response", async () => {
    const path = tempPath(), db = setup(1, path), other = open(path); let time = NOW;
    let finish!: (r: EnrichmentResult) => void;
    const worker = new MarketScheduler(db, { workerId: "late", now: () => time, enrichmentHandler: async () => new Promise((resolve) => { finish = resolve; }) });
    worker.wake(); time += 200_000;
    const takeover = claimJobs(other, "enrich", time, 1)[0]!;
    finish(enrichment(100)); await new Promise((resolve) => setImmediate(resolve));
    expect(count(db, "market_attributes")).toBe(0); expect(ownsLease(other, takeover, time)).toBe(true);
    await worker.stop();
    retryJob(other, takeover, time, "test retry", 0);
    const good = new MarketScheduler(other, { workerId: "good", now: () => time, enrichmentHandler: async () => enrichment(100, time) });
    good.wake(); await new Promise((resolve) => setImmediate(resolve));
    expect(count(db, "market_attributes")).toBe(1);
    expect(other.prepare("SELECT refresh_status,last_refresh FROM market_celebrities").get()).toEqual({ refresh_status: "ok", last_refresh: time });
    expect(count(db, "market_snapshots")).toBe(1); await good.stop();
    expect(canon(marketState(other).config)).toBe(canon(DEFAULT_CONFIG));
  });
});
