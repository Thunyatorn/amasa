import type { Database } from "better-sqlite3";
import { canon, sha256 } from "@amasa/schemas/canon";

// SPEC §13: append-only, hash-chained audit log (invariant I5).
// payload is stored as canon(obj); payload_hash = sha256(obj);
// hash = sha256({ seq, ts, type, payloadHash, prevHash }); the first row's prev_hash is 64 zeros.

export const GENESIS_HASH = "0".repeat(64);

export type AuditType =
  | "contract_confirmed" | "cart_created" | "verdict" | "approved"
  | "payment_link_created" | "payment_failed" | "outcome_recorded"
  | "autonomy_changed" | "profile_changed";

export function migrateAudit(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS audit (
    seq INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    erased INTEGER NOT NULL DEFAULT 0
  )`);
}

const rowHash = (seq: number, ts: string, type: string, payloadHash: string, prevHash: string) =>
  sha256({ seq, ts, type, payloadHash, prevHash });

interface Row { seq: number; ts: string; type: string; payload: string; payload_hash: string; prev_hash: string; hash: string; erased: number }

// Reads the last row and inserts in one IMMEDIATE transaction (takes the write lock first), so
// concurrent appends, even from another process, cannot fork the chain.
export function appendAudit(db: Database, type: AuditType, payload: Record<string, unknown>, ts: string): { seq: number; hash: string } {
  const run = db.transaction(() => {
    const last = db.prepare("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1").get() as
      { seq: number; hash: string } | undefined;
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const payloadHash = sha256(payload);
    const hash = rowHash(seq, ts, type, payloadHash, prevHash);
    db.prepare(`INSERT INTO audit (seq, ts, type, payload, payload_hash, prev_hash, hash, erased)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(seq, ts, type, canon(payload), payloadHash, prevHash, hash);
    return { seq, hash };
  });
  return run.immediate();
}

export interface AuditCheck { ok: boolean; length: number; brokenAt: number | null }

// Recomputes the chain. Every row: seq is contiguous, prev_hash links to the previous row's hash,
// and hash matches its fields. Rows with erased = 0: sha256(payload) === payload_hash.
export function verifyAudit(db: Database): AuditCheck {
  const rows = db.prepare("SELECT * FROM audit ORDER BY seq ASC").all() as Row[];
  let prev = GENESIS_HASH;
  for (const [i, r] of rows.entries()) {
    const broken = (): AuditCheck => ({ ok: false, length: rows.length, brokenAt: r.seq });
    if (r.seq !== i + 1 || r.prev_hash !== prev) return broken();
    if (rowHash(r.seq, r.ts, r.type, r.payload_hash, r.prev_hash) !== r.hash) return broken();
    if (r.erased === 0) {
      let parsed: unknown;
      try { parsed = JSON.parse(r.payload); } catch { return broken(); }
      if (sha256(parsed) !== r.payload_hash) return broken();
    }
    prev = r.hash;
  }
  return { ok: true, length: rows.length, brokenAt: null };
}

export function chainHead(db: Database): string {
  const last = db.prepare("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
  return last?.hash ?? GENESIS_HASH;
}

// Used by DELETE /api/me (M5): personal data goes, every hash stays, so the chain still verifies.
export function eraseAuditPayloads(db: Database): void {
  db.prepare("UPDATE audit SET payload = '{}', erased = 1").run();
}
