import type { Db } from "../db/index.ts";

export function migrateMarket(db: Db): void {
  // Per connection, before transactions. Existing shopping tables have no FK declarations.
  db.pragma("foreign_keys = ON");
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS market_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
    if (!db.prepare("SELECT 1 FROM market_migrations WHERE version=1").get()) {
    db.exec(`
      CREATE TABLE market_configs (
        hash TEXT PRIMARY KEY, json TEXT NOT NULL CHECK(json_valid(json)), created_at INTEGER NOT NULL);
      CREATE TABLE market_state (
        id INTEGER PRIMARY KEY CHECK(id=1), seed TEXT NOT NULL,
        config_hash TEXT NOT NULL REFERENCES market_configs(hash));
      CREATE TABLE market_celebrities (
        id INTEGER PRIMARY KEY CHECK(id>=0), name TEXT NOT NULL, imagefile TEXT NOT NULL UNIQUE,
        qid TEXT UNIQUE CHECK(qid IS NULL OR (qid GLOB 'Q[1-9]*' AND substr(qid,2) NOT GLOB '*[^0-9]*')),
        alias_of INTEGER REFERENCES market_celebrities(id) CHECK(alias_of IS NULL OR alias_of<>id),
        identity_status TEXT NOT NULL DEFAULT 'unresolved' CHECK(identity_status IN ('unresolved','resolved','needs_review','alias')),
        aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases_json)),
        initial_micros INTEGER NOT NULL CHECK(typeof(initial_micros)='integer' AND initial_micros>0 AND initial_micros<=9007199254740991),
        current_micros INTEGER NOT NULL CHECK(typeof(current_micros)='integer' AND current_micros>0 AND current_micros<=9007199254740991),
        last_tick INTEGER, next_tick INTEGER, last_refresh INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
        refresh_status TEXT NOT NULL DEFAULT 'pending' CHECK(refresh_status IN ('pending','ok','error','deferred')),
        version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0), last_error TEXT);
      CREATE INDEX market_celebrities_due ON market_celebrities(status,next_tick);
      CREATE TABLE market_sources (
        url TEXT PRIMARY KEY, payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
        etag TEXT, last_modified TEXT, checked_at INTEGER NOT NULL);
      CREATE TABLE market_evidence (
        hash TEXT PRIMARY KEY, celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id),
        source_url TEXT NOT NULL REFERENCES market_sources(url), source_hash TEXT NOT NULL,
        json TEXT NOT NULL CHECK(json_valid(json)), created_at INTEGER NOT NULL);
      CREATE INDEX market_evidence_entity ON market_evidence(celebrity_id,created_at);
      CREATE TABLE market_attributes (
        celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id), key TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version>0), value_hash TEXT NOT NULL,
        json TEXT NOT NULL CHECK(json_valid(json)), PRIMARY KEY(celebrity_id,key));
      CREATE TABLE market_attribute_changes (
        id INTEGER PRIMARY KEY, celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id),
        key TEXT NOT NULL, version INTEGER NOT NULL, previous_hash TEXT, hash TEXT NOT NULL,
        json TEXT NOT NULL CHECK(json_valid(json)), changed_at INTEGER NOT NULL,
        UNIQUE(celebrity_id,key,version));
      CREATE TABLE market_assets (
        celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id), asset_id TEXT NOT NULL,
        json TEXT NOT NULL CHECK(json_valid(json)), hash TEXT NOT NULL, PRIMARY KEY(celebrity_id,asset_id));
      CREATE TABLE market_snapshots (
        hash TEXT PRIMARY KEY, celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id),
        json TEXT NOT NULL CHECK(json_valid(json)), created_at INTEGER NOT NULL);
      CREATE INDEX market_snapshots_entity ON market_snapshots(celebrity_id,created_at);
      CREATE TABLE market_features (
        celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id), key TEXT NOT NULL,
        json TEXT NOT NULL CHECK(json_valid(json)), expires_at INTEGER NOT NULL, PRIMARY KEY(celebrity_id,key));
      CREATE TABLE market_weights (
        celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id), feature_key TEXT NOT NULL,
        value REAL NOT NULL CHECK(value>=-1 AND value<=1), version INTEGER NOT NULL CHECK(version>0),
        event_id TEXT NOT NULL, PRIMARY KEY(celebrity_id,feature_key));
      CREATE TABLE market_history (
        event_id TEXT PRIMARY KEY, celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id),
        previous_micros INTEGER NOT NULL CHECK(typeof(previous_micros)='integer' AND previous_micros>0 AND previous_micros<=9007199254740991),
        new_micros INTEGER NOT NULL CHECK(typeof(new_micros)='integer' AND new_micros>0 AND new_micros<=9007199254740991),
        score REAL NOT NULL CHECK(score>=-1 AND score<=1), sigma REAL NOT NULL CHECK(sigma>0 AND sigma<1),
        pct REAL NOT NULL, config_hash TEXT NOT NULL REFERENCES market_configs(hash),
        snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), snapshot_hash TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL, processed_at INTEGER NOT NULL, version INTEGER NOT NULL,
        UNIQUE(celebrity_id,version));
      CREATE INDEX market_history_entity_time ON market_history(celebrity_id,processed_at,event_id);
      CREATE TABLE market_jobs (
        id TEXT PRIMARY KEY, celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id),
        kind TEXT NOT NULL CHECK(kind IN ('price','enrich')), due_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','retry','done','paused')),
        lease_token TEXT, lease_expires INTEGER, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
        error TEXT, retry_at INTEGER, completed_at INTEGER,
        CHECK((status='running' AND lease_token IS NOT NULL AND lease_expires IS NOT NULL) OR
          (status<>'running' AND lease_token IS NULL AND lease_expires IS NULL)));
      CREATE INDEX market_jobs_due ON market_jobs(kind,status,due_at,id);
      CREATE INDEX market_jobs_leases ON market_jobs(kind,status,lease_expires);
      CREATE UNIQUE INDEX market_jobs_one_live ON market_jobs(celebrity_id,kind) WHERE status IN ('pending','running','retry');
      CREATE TABLE market_workers (
        id TEXT PRIMARY KEY, heartbeat_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','stopped')), json TEXT NOT NULL CHECK(json_valid(json)));
      CREATE TABLE market_host_limits (
        host TEXT PRIMARY KEY, next_allowed_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0,
        failures INTEGER NOT NULL DEFAULT 0 CHECK(failures>=0));
    `);
    for (const table of ["market_history", "market_attribute_changes", "market_snapshots", "market_evidence", "market_configs"]) {
      db.exec(`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable market record'); END;
        CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable market record'); END;`);
    }
    db.prepare("INSERT INTO market_migrations VALUES(1,?)").run(Date.now());
    }
    if (!db.prepare("SELECT 1 FROM market_migrations WHERE version=2").get()) {
      db.exec(`CREATE TABLE market_http_cache(endpoint TEXT PRIMARY KEY, source_url TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)), expires_at INTEGER NOT NULL);
        CREATE TABLE market_ai_success(celebrity_id INTEGER PRIMARY KEY REFERENCES market_celebrities(id), input_hash TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)));
        CREATE TABLE market_identity_decisions(id INTEGER PRIMARY KEY, celebrity_id INTEGER NOT NULL REFERENCES market_celebrities(id), json TEXT NOT NULL CHECK(json_valid(json)), created_at INTEGER NOT NULL);
        CREATE TRIGGER market_identity_decisions_immutable_update BEFORE UPDATE ON market_identity_decisions BEGIN SELECT RAISE(ABORT,'immutable market record'); END;
        CREATE TRIGGER market_identity_decisions_immutable_delete BEFORE DELETE ON market_identity_decisions BEGIN SELECT RAISE(ABORT,'immutable market record'); END;`);
      db.prepare("INSERT INTO market_migrations VALUES(2,?)").run(Date.now());
    }
  }).immediate();
}
