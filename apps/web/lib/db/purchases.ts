import { Purchase, type Category, type FailureCode, type PurchaseStatus } from "@amasa/schemas";
import { z } from "zod";
import type { Db } from "./index";

export function insertPurchase(db: Db, p: {
  purchaseNumber: string; cartId: string; contractId: string; category: Category;
  status: "verified" | "blocked"; totalCents: number; failureCodes: FailureCode[]; now: string; brands?: string[];
}): void {
  db.prepare(`INSERT INTO purchases (purchase_number, cart_id, contract_id, category, status, total_cents, payment_link_url, failure_codes, created_at, brands_json)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`)
    .run(p.purchaseNumber, p.cartId, p.contractId, p.category, p.status, p.totalCents,
      p.failureCodes.length ? JSON.stringify(p.failureCodes) : null, p.now, JSON.stringify([...new Set(p.brands ?? [])]));
}

interface PurchaseRow {
  purchase_number: string; cart_id: string; contract_id: string; category: string; status: string; total_cents: number;
  payment_link_url: string | null; created_at: string; failure_codes: string | null; brands_json: string; audit_head: string | null; outcome_reason: string | null;
}
export type PurchaseRecord = { purchase: Purchase; failureCodes: FailureCode[]; brands: string[]; auditHead: string | null; outcomeReason: string | null };

const toRecord = (row: PurchaseRow): PurchaseRecord => ({
  purchase: Purchase.parse({ purchaseNumber: row.purchase_number, cartId: row.cart_id, contractId: row.contract_id, category: row.category,
    status: row.status, totalCents: row.total_cents, paymentLinkUrl: row.payment_link_url, createdAt: row.created_at }),
  failureCodes: row.failure_codes ? JSON.parse(row.failure_codes) : [],
  brands: z.array(z.string()).parse(JSON.parse(row.brands_json)),
  auditHead: row.audit_head,
  outcomeReason: row.outcome_reason,
});

export function getPurchase(db: Db, purchaseNumber: string): PurchaseRecord | null {
  const row = db.prepare("SELECT * FROM purchases WHERE purchase_number = ?").get(purchaseNumber) as PurchaseRow | undefined;
  return row ? toRecord(row) : null;
}

// Purchases in a category that ended with the given outcome (for brand suggestions, SPEC §12).
export function purchasesWithOutcome(db: Db, category: Category, status: "kept" | "returned"): PurchaseRecord[] {
  return (db.prepare("SELECT * FROM purchases WHERE category = ? AND status = ?").all(category, status) as PurchaseRow[]).map(toRecord);
}

export function setAuditHead(db: Db, purchaseNumber: string, hash: string): void {
  db.prepare("UPDATE purchases SET audit_head = ? WHERE purchase_number = ?").run(hash, purchaseNumber);
}

export function setOutcomeReason(db: Db, purchaseNumber: string, reason: string | null): void {
  db.prepare("UPDATE purchases SET outcome_reason = ? WHERE purchase_number = ?").run(reason, purchaseNumber);
}

export function getPurchaseStatus(db: Db, purchaseNumber: string): PurchaseStatus | null {
  const row = db.prepare("SELECT status FROM purchases WHERE purchase_number = ?").get(purchaseNumber) as { status: PurchaseStatus } | undefined;
  return row?.status ?? null;
}

// Moves a purchase forward only from the expected state; returns false if it was not there.
export function transitionPurchase(db: Db, purchaseNumber: string, from: PurchaseStatus, to: PurchaseStatus, paymentLinkUrl?: string): boolean {
  return db.prepare("UPDATE purchases SET status = ?, payment_link_url = COALESCE(?, payment_link_url) WHERE purchase_number = ? AND status = ?")
    .run(to, paymentLinkUrl ?? null, purchaseNumber, from).changes === 1;
}

// Rolling 7-day spend in a category (for WEEKLY_CAP_EXCEEDED): approved (payment in flight), links
// created, kept or returned. Counting approved stops two concurrent approvals both passing.
export function spentThisWeekCents(db: Db, category: Category, nowMs: number): number {
  const since = new Date(nowMs - 7 * 86_400_000).toISOString();
  const row = db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS s FROM purchases
    WHERE category = ? AND status IN ('approved', 'link_created', 'kept', 'returned') AND created_at >= ?`).get(category, since) as { s: number };
  return row.s;
}
