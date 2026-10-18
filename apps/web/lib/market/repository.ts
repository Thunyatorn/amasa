import { canon, sha256 } from "@amasa/schemas";
import type { Db } from "../db/index.ts";
import { DEFAULT_CONFIG, MarketConfig } from "./config.ts";
import { changedFeature } from "./features.ts";
import { Attribute, EnrichmentResult, Features, type Feature } from "./schemas.ts";
import { validateGrounding } from "./grounding.ts";
import { chooseIdentity, parseEntities } from "./wikidata.ts";

export interface Celebrity {
  id: number; name: string; current_micros: number; initial_micros: number; version: number;
  status: "active" | "paused"; next_tick: number | null; last_tick: number | null;
  qid: string | null; identity_status: string;
}
export function celebrity(db: Db, id: number): Celebrity {
  const row = db.prepare("SELECT * FROM market_celebrities WHERE id=?").get(id) as Celebrity | undefined;
  if (!row) throw new Error("Unknown market celebrity");
  return row;
}
export function initializeMarket(db: Db, seed: string, now: number, input: MarketConfig = DEFAULT_CONFIG): void {
  if (!seed.trim() || seed.length > 200) throw new Error("Invalid market seed");
  const config = MarketConfig.parse(input), hash = sha256(config);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO market_configs VALUES(?,?,?)").run(hash, canon(config), now);
    db.prepare("INSERT OR IGNORE INTO market_state VALUES(1,?,?)").run(seed, hash);
  }).immediate();
}
export function marketState(db: Db): { seed: string; config: MarketConfig; configHash: string } {
  const row = db.prepare(`SELECT s.seed,c.json,c.hash FROM market_state s JOIN market_configs c ON c.hash=s.config_hash WHERE s.id=1`)
    .get() as { seed: string; json: string; hash: string } | undefined;
  if (!row) throw new Error("Market not seeded; run pnpm market:seed");
  const config = MarketConfig.parse(JSON.parse(row.json));
  if (sha256(config) !== row.hash) throw new Error("Market config hash mismatch");
  return { seed: row.seed, config, configHash: row.hash };
}
export function setMarketConfig(db: Db, input: MarketConfig, now: number): string {
  const config = MarketConfig.parse(input), hash = sha256(config);
  db.transaction(() => {
    marketState(db);
    db.prepare("INSERT OR IGNORE INTO market_configs VALUES(?,?,?)").run(hash, canon(config), now);
    db.prepare("UPDATE market_state SET config_hash=? WHERE id=1").run(hash);
  }).immediate();
  return hash;
}
export function storedFeatures(db: Db, id: number): Feature[] {
  const rows = db.prepare("SELECT json FROM market_features WHERE celebrity_id=? ORDER BY key").all(id) as { json: string }[];
  return Features.parse(rows.map((r) => JSON.parse(r.json)));
}

// Called only inside the worker's fenced commit transaction (or a caller-owned transaction).
// A repeat fetch updates checkedAt/source validators, but does not renew a signal or value version.
export function saveEnrichment(db: Db, id: number, input: EnrichmentResult, now: number): void {
  db.transaction(() => saveEnrichmentInTransaction(db, id, input, now)).immediate();
}
function saveEnrichmentInTransaction(db: Db, id: number, input: EnrichmentResult, now: number): void {
  celebrity(db, id);
  const result = EnrichmentResult.parse(input), { config } = marketState(db);
  const current = celebrity(db, id);
  if (result.identity) {
    const decision = result.identity;
    if (decision.status === "resolved") {
      const entities = result.sources.filter(s => decision.sourceUrls.includes(s.url)).flatMap(s => { try { return parseEntities(s); } catch { return []; } });
      const selected = chooseIdentity(current.name, entities);
      if (!selected || selected.id !== decision.qid || current.qid && current.qid !== selected.id) throw new Error("IDENTITY_EVIDENCE_INVALID");
    }
    db.prepare("INSERT INTO market_identity_decisions(celebrity_id,json,created_at) VALUES(?,?,?)").run(id, canon(decision), now);
    if (decision.status !== "resolved" || !decision.qid || assignQid(db, id, decision.qid) !== "resolved") {
      db.prepare("UPDATE market_celebrities SET identity_status='needs_review',refresh_status='deferred' WHERE id=?").run(id);
      return; // Duplicate/ambiguous identities must never receive another entity's facts.
    }
  }
  validateGrounding(result, result.identity?.qid ?? current.qid, now);
  let changed = false;
  const sources = new Map(result.sources.map((s) => [s.url, s]));
  for (const source of sources.values()) {
    const hash = sha256({ payload: source.payload });
    db.prepare(`INSERT INTO market_sources VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
      payload=excluded.payload,payload_hash=excluded.payload_hash,etag=excluded.etag,last_modified=excluded.last_modified,checked_at=excluded.checked_at`)
      .run(source.url, source.payload, hash, source.etag, source.lastModified, source.checkedAt);
  }
  for (const value of [...result.attributes, ...result.assets]) {
    if (!db.prepare("SELECT 1 FROM market_sources WHERE url=?").get(value.provenance.sourceUrl))
      throw new Error("Attribute or asset source missing");
    if (value.provenance.retrievedAt > now || value.provenance.effectiveDate && value.provenance.effectiveDate > new Date(now).toISOString().slice(0, 10))
      throw new Error("Future dated evidence");
  }
  for (const evidence of result.evidence) {
    const source = sources.get(evidence.provenance.sourceUrl);
    const cached = db.prepare("SELECT payload_hash FROM market_sources WHERE url=?").get(evidence.provenance.sourceUrl) as { payload_hash: string } | undefined;
    if (!cached || cached.payload_hash !== evidence.sourceHash) throw new Error("Evidence source hash mismatch");
    // Preserve the original payload in the immutable evidence envelope, even after source cache changes.
    const payload = source?.payload ?? (db.prepare("SELECT payload FROM market_sources WHERE url=?").get(evidence.provenance.sourceUrl) as { payload: string }).payload;
    const envelope = { celebrityId: id, evidence, payload }, hash = sha256(envelope);
    db.prepare("INSERT OR IGNORE INTO market_evidence VALUES(?,?,?,?,?,?)")
      .run(hash, id, evidence.provenance.sourceUrl, evidence.sourceHash, canon(envelope), now);
  }
  for (const a of result.attributes) {
    // Retrieval metadata is not a value change. Confidence/source/status updates are retained in
    // snapshots, while only actual datatype/value/currency changes advance this feature's version.
    const valueHash = sha256({ datatype: a.datatype, value: a.value, currency: a.currency });
    const row = db.prepare("SELECT json,version,value_hash FROM market_attributes WHERE celebrity_id=? AND key=?").get(id, a.key) as
      { json: string; version: number; value_hash: string } | undefined;
    if (row?.value_hash === valueHash) {
      db.prepare("UPDATE market_attributes SET json=? WHERE celebrity_id=? AND key=?").run(canon(a), id, a.key);
      continue;
    }
    const before = row ? Attribute.parse(JSON.parse(row.json)) : undefined;
    if (before?.provenance.effectiveDate && a.provenance.effectiveDate && a.provenance.effectiveDate < before.provenance.effectiveDate) continue;
    const version = (row?.version ?? 0) + 1;
    changed = true;
    const envelope = { celebrityId: id, attribute: a, version }, hash = sha256(envelope);
    db.prepare("INSERT INTO market_attribute_changes(celebrity_id,key,version,previous_hash,hash,json,changed_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, a.key, version, row?.value_hash ?? null, hash, canon(envelope), now);
    db.prepare(`INSERT INTO market_attributes VALUES(?,?,?,?,?) ON CONFLICT(celebrity_id,key) DO UPDATE SET
      version=excluded.version,value_hash=excluded.value_hash,json=excluded.json`).run(id, a.key, version, valueHash, canon(a));
    const feature = changedFeature(before, a, version, now, config);
    if (feature) db.prepare(`INSERT INTO market_features VALUES(?,?,?,?) ON CONFLICT(celebrity_id,key) DO UPDATE SET json=excluded.json,expires_at=excluded.expires_at`)
      .run(id, a.key, canon(feature), feature.expiresAt);
    else db.prepare("DELETE FROM market_features WHERE celebrity_id=? AND key=?").run(id, a.key);
  }
  for (const asset of result.assets) {
    const old = db.prepare("SELECT json FROM market_assets WHERE celebrity_id=? AND asset_id=?").get(id, asset.assetId) as { json: string } | undefined;
    const previous = old ? JSON.parse(old.json) as { amount: number; currency: string; description: string } : undefined;
    if (!previous || previous.amount !== asset.amount || previous.currency !== asset.currency || previous.description !== asset.description) changed = true;
    db.prepare(`INSERT INTO market_assets VALUES(?,?,?,?) ON CONFLICT(celebrity_id,asset_id) DO UPDATE SET json=excluded.json,hash=excluded.hash`)
      .run(id, asset.assetId, canon(asset), sha256(asset));
  }
  const snapshot = { celebrityId: id, attributes: result.attributes, assets: result.assets, evidence: result.evidence };
  if (changed) db.prepare("INSERT OR IGNORE INTO market_snapshots VALUES(?,?,?,?)").run(sha256(snapshot), id, canon(snapshot), now);
  db.prepare("UPDATE market_celebrities SET last_refresh=?,refresh_status='ok' WHERE id=?").run(now, id);
  if (result.aiSuccess) db.prepare(`INSERT INTO market_ai_success VALUES(?,?,?) ON CONFLICT(celebrity_id) DO UPDATE SET input_hash=excluded.input_hash,json=excluded.json`)
    .run(id, result.aiSuccess.inputHash, canon(result));
}

export function assignQid(db: Db, id: number, qid: string): "resolved" | "needs_review" {
  if (!/^Q[1-9][0-9]*$/.test(qid)) throw new Error("Invalid canonical QID");
  return db.transaction(() => {
    celebrity(db, id);
    const owner = db.prepare("SELECT id FROM market_celebrities WHERE qid=? AND id<>?").get(qid, id) as { id: number } | undefined;
    if (owner) {
      db.prepare("UPDATE market_celebrities SET identity_status='needs_review',alias_of=? WHERE id=?").run(owner.id, id);
      db.prepare("UPDATE market_celebrities SET identity_status='needs_review' WHERE id=?").run(owner.id);
      return "needs_review" as const;
    }
    db.prepare("UPDATE market_celebrities SET qid=?,identity_status='resolved',alias_of=NULL WHERE id=?").run(qid, id);
    return "resolved" as const;
  }).immediate();
}

// Phase 2 retrieval can atomically reserve a host slot across worker processes.
export function reserveHost(db: Db, host: string, now: number, spacingMs: number): boolean {
  if (!host || !Number.isSafeInteger(spacingMs) || spacingMs < 0) throw new Error("Invalid host limit");
  return db.transaction(() => {
    const row = db.prepare("SELECT next_allowed_at,blocked_until FROM market_host_limits WHERE host=?").get(host) as
      { next_allowed_at: number; blocked_until: number } | undefined;
    if (row && Math.max(row.next_allowed_at, row.blocked_until) > now) return false;
    db.prepare(`INSERT INTO market_host_limits(host,next_allowed_at) VALUES(?,?) ON CONFLICT(host) DO UPDATE SET next_allowed_at=excluded.next_allowed_at`)
      .run(host, now + spacingMs);
    return true;
  }).immediate();
}
