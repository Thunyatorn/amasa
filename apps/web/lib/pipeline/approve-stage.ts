import { z } from "zod";
import { PaymentRequest } from "@amasa/schemas";
import { appendAudit } from "@amasa/audit";
import { getDb } from "../db";
import { getAutonomy } from "../db/autonomy";
import { consumeNonce, getCart } from "../db/carts";
import { getPurchaseStatus, setAuditHead, spentThisWeekCents, transitionPurchase } from "../db/purchases";
import { ApiError } from "../http";
import { requestPaymentLink } from "../payments-client";

export const ApproveBody = z.strictObject({ cartId: z.string().uuid(), approvalNonce: z.string().min(1).max(100) });

// Stages 7–8 (SPEC §5, §10): check the verdict is live, consume the single-use nonce, re-read
// autonomy (I7), then hand the signed request to the payments service. No model is involved (I1).
export async function approveCart(cartId: string, approvalNonce: string, nowMs = Date.now()): Promise<{ purchaseNumber: string; paymentLinkUrl: string }> {
  const db = getDb();
  const record = getCart(db, cartId);
  if (!record) throw new ApiError(404, "CART_NOT_FOUND", "That cart was not found.");
  const approval = record.approval;
  if (!approval) throw new ApiError(409, "NOT_VERIFIED", "This cart has not passed the checks. Verify it first.");
  const { fields, signature, quote } = approval;

  if (nowMs > fields.expiresAt) {
    throw new ApiError(409, "VERDICT_EXPIRED", "This approval expired after 5 minutes. Check the cart again to continue.");
  }
  if (getPurchaseStatus(db, fields.purchaseNumber) !== "verified") {
    throw new ApiError(409, "NOT_VERIFIED", "This purchase is no longer waiting for approval.");
  }

  // Build the payment request before spending the nonce, so a bad stored quote cannot leave the
  // purchase stuck in "approved".
  const request = PaymentRequest.safeParse({
    fields,
    signature,
    lines: quote.lines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, unitCents: l.unitCents })),
    taxCents: quote.taxCents,
    shippingCents: quote.shippingCents,
  });
  if (!request.success) throw new ApiError(409, "NOT_VERIFIED", "This cart needs to be checked again before it can be approved.");

  // One write transaction: re-read autonomy (I7) and the weekly spend, then consume the nonce. A
  // concurrent approval waits for the lock, so it sees this purchase as spent.
  const ts = new Date(nowMs).toISOString();
  const outcomeOfConsume = db.transaction((): "ok" | "cap" | "nonce" => {
    const autonomy = getAutonomy(db, fields.category);
    if (autonomy.level === 2 && spentThisWeekCents(db, fields.category, nowMs) + fields.totalCents > autonomy.weeklyCapCents) return "cap";
    if (!consumeNonce(db, cartId, approvalNonce)) return "nonce";
    transitionPurchase(db, fields.purchaseNumber, "verified", "approved");
    appendAudit(db, "approved", { cartId, purchaseNumber: fields.purchaseNumber, totalCents: fields.totalCents }, ts);
    return "ok";
  }).immediate();
  if (outcomeOfConsume === "cap") throw new ApiError(409, "WEEKLY_CAP_EXCEEDED", "This order would go over your weekly limit.");
  if (outcomeOfConsume === "nonce") throw new ApiError(409, "NONCE_INVALID", "This approval was already used or is not valid.");

  const outcome = await requestPaymentLink(request.data);
  const doneTs = new Date().toISOString();

  if (!outcome.ok) {
    db.transaction(() => {
      transitionPurchase(db, fields.purchaseNumber, "approved", "payment_failed");
      appendAudit(db, "payment_failed", { purchaseNumber: fields.purchaseNumber, code: outcome.code }, doneTs);
    }).immediate();
    throw new ApiError(502, "PAYMENT_FAILED", "The secure payment page could not be prepared. Nothing was charged.");
  }

  db.transaction(() => {
    transitionPurchase(db, fields.purchaseNumber, "approved", "link_created", outcome.paymentLinkUrl);
    const { hash } = appendAudit(db, "payment_link_created", { purchaseNumber: fields.purchaseNumber, totalCents: fields.totalCents }, doneTs);
    // The receipt shows the audit chain head at purchase time (SPEC §13).
    setAuditHead(db, fields.purchaseNumber, hash);
  }).immediate();
  return { purchaseNumber: fields.purchaseNumber, paymentLinkUrl: outcome.paymentLinkUrl };
}
