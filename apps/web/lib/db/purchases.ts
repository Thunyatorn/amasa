import type { Category, FailureCode, PurchaseStatus } from "@amasa/schemas";
import type { Db } from "./index";

export function insertPurchase(db: Db, p: {
  purchaseNumber: string; cartId: string; contractId: string; category: Category;
  status: "verified" | "blocked"; totalCents: number; failureCodes: FailureCode[]; now: string;
}): void {
  db.prepare(`INSERT INTO purchases (purchase_number, cart_id, contract_id, category, status, total_cents, payment_link_url, failure_codes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
    .run(p.purchaseNumber, p.cartId, p.contractId, p.category, p.status, p.totalCents,
      p.failureCodes.length ? JSON.stringify(p.failureCodes) : null, p.now);
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

// Rolling 7-day spend in a category: links created, kept or returned (for WEEKLY_CAP_EXCEEDED).
export function spentThisWeekCents(db: Db, category: Category, nowMs: number): number {
  const since = new Date(nowMs - 7 * 86_400_000).toISOString();
  const row = db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS s FROM purchases
    WHERE category = ? AND status IN ('link_created', 'kept', 'returned') AND created_at >= ?`).get(category, since) as { s: number };
  return row.s;
}
