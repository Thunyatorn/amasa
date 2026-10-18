import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAudit, chainHead, eraseAuditPayloads, GENESIS_HASH, migrateAudit, verifyAudit } from "./audit.ts";

describe("audit log (SPEC §13)", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    migrateAudit(db);
  });

  const fill = () => {
    appendAudit(db, "contract_confirmed", { contractId: "c1", contractHash: "a".repeat(64) }, "2026-10-17T00:00:01.000Z");
    appendAudit(db, "cart_created", { cartId: "k1" }, "2026-10-17T00:00:02.000Z");
    appendAudit(db, "verdict", { cartId: "k1", pass: true, totalCents: 13932, codes: [] }, "2026-10-17T00:00:03.000Z");
  };

  it("an empty log verifies, head is the genesis hash", () => {
    expect(verifyAudit(db)).toEqual({ ok: true, length: 0, brokenAt: null });
    expect(chainHead(db)).toBe(GENESIS_HASH);
  });

  it("appends a linked chain that verifies", () => {
    fill();
    expect(verifyAudit(db)).toEqual({ ok: true, length: 3, brokenAt: null });
    const rows = db.prepare("SELECT seq, prev_hash, hash FROM audit ORDER BY seq").all() as Array<{ seq: number; prev_hash: string; hash: string }>;
    expect(rows[0]!.prev_hash).toBe(GENESIS_HASH);
    expect(rows[1]!.prev_hash).toBe(rows[0]!.hash);
    expect(chainHead(db)).toBe(rows[2]!.hash);
  });

  it("editing one row's payload returns that row's seq", () => {
    fill();
    db.prepare("UPDATE audit SET payload = ? WHERE seq = 2").run('{"cartId":"k2"}');
    expect(verifyAudit(db)).toEqual({ ok: false, length: 3, brokenAt: 2 });
  });

  it("editing one row's hash, type or ts returns that row's seq", () => {
    for (const [col, val] of [["hash", "f".repeat(64)], ["type", "approved"], ["ts", "2026-10-18T00:00:00.000Z"]] as const) {
      const fresh = new Database(":memory:");
      migrateAudit(fresh);
      db = fresh;
      fill();
      db.prepare(`UPDATE audit SET ${col} = ? WHERE seq = 2`).run(val);
      expect(verifyAudit(db).brokenAt, col).toBe(2);
    }
  });

  it("deleting a row breaks the chain at the gap", () => {
    fill();
    db.prepare("DELETE FROM audit WHERE seq = 2").run();
    expect(verifyAudit(db).brokenAt).toBe(3);
  });

  it("payload text that is not JSON is reported as broken", () => {
    fill();
    db.prepare("UPDATE audit SET payload = 'not json' WHERE seq = 1").run();
    expect(verifyAudit(db).brokenAt).toBe(1);
  });

  it("setting erased = 1 cannot hide an edited payload", () => {
    fill();
    db.prepare("UPDATE audit SET erased = 1, payload = ? WHERE seq = 2").run('{"cartId":"forged"}');
    expect(verifyAudit(db).brokenAt).toBe(2);
    db.prepare("UPDATE audit SET erased = 2, payload = '{}' WHERE seq = 2").run();
    expect(verifyAudit(db).brokenAt).toBe(2);
  });

  it("erasing payloads keeps every hash, so the chain still verifies", () => {
    fill();
    eraseAuditPayloads(db);
    expect(verifyAudit(db)).toEqual({ ok: true, length: 3, brokenAt: null });
    appendAudit(db, "approved", { cartId: "k1" }, "2026-10-17T00:00:04.000Z");
    expect(verifyAudit(db)).toEqual({ ok: true, length: 4, brokenAt: null });
  });
});
