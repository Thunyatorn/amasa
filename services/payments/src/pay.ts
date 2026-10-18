import type { KeyObject } from "node:crypto";
import type Database from "better-sqlite3";
import { cartHash } from "@amasa/schemas/cart-hash";
import { PaymentRequest } from "./schema";
import { checkVerdict } from "./verdict";

// SPEC §10.3: POST /pay checks, in this order. Step 1 (listen on 127.0.0.1) is in server.ts.
// Any failed check returns { code, message } and leaves no Visa call behind.

export interface PayDeps {
  db: Database.Database;
  publicKey: KeyObject;
  maxDailyCents: number;
  now: () => number;
  // Calls Visa; returns the link URL, the amount Visa will charge (cents) and the raw result.
  // Throws on failure.
  createLink: (req: PaymentRequest) => Promise<{ paymentLinkUrl: string; chargedCents: number; result: unknown }>;
}

export interface PayResult {
  status: number;
  body: { purchaseNumber: string; paymentLinkUrl: string } | { code: string; message: string };
}

const err = (status: number, code: string, message: string): PayResult => ({ status, body: { code, message } });

export async function handlePay(raw: unknown, deps: PayDeps): Promise<PayResult> {
  // 2. Parse with the zod 3 copy of PaymentRequest.
  const parsed = PaymentRequest.safeParse(raw);
  if (!parsed.success) return err(400, "INVALID_REQUEST", "The payment request is not valid.");
  const req = parsed.data;
  const f = req.fields;

  // 3. The verdict signature is valid.
  if (!checkVerdict(f, req.signature, deps.publicKey)) {
    return err(403, "BAD_SIGNATURE", "The approval signature is not valid.");
  }

  // 4. The verdict has not expired.
  const now = deps.now();
  if (now > f.expiresAt) return err(403, "VERDICT_EXPIRED", "The approval has expired. Verify the cart again.");

  // 5. Reserve the purchase number before any Visa call. A duplicate is rejected with 409.
  try {
    deps.db.prepare("INSERT INTO payments (purchase_number, status, total_cents, result_json, created_at) VALUES (?, 'reserved', ?, NULL, ?)")
      .run(f.purchaseNumber, f.totalCents, new Date(now).toISOString());
  } catch (e) {
    if (e instanceof Error && /UNIQUE|PRIMARY KEY/i.test(e.message)) {
      return err(409, "DUPLICATE_PURCHASE", "This purchase was already submitted.");
    }
    throw e;
  }
  const reject = (status: number, code: string, message: string): PayResult => {
    deps.db.prepare("UPDATE payments SET status = 'rejected', result_json = ? WHERE purchase_number = ?")
      .run(JSON.stringify({ code }), f.purchaseNumber);
    return err(status, code, message);
  };

  // 6. Rebuild cartHash from the request and compare with the signed one.
  const rebuilt = cartHash({ merchant: f.merchant, currency: f.currency, lines: req.lines, taxCents: req.taxCents, shippingCents: req.shippingCents });
  if (rebuilt !== f.cartHash) return reject(400, "CART_HASH_MISMATCH", "The items or prices do not match the approved cart.");

  // 7. Line totals + tax + shipping equal the signed total.
  const sum = req.lines.reduce((s, l) => s + l.unitCents * l.qty, 0) + req.taxCents + req.shippingCents;
  if (sum !== f.totalCents) return reject(400, "TOTAL_MISMATCH", "The total does not match the approved total.");

  // 8. The total is within the contract's budget cap (I3, checked again here in a separate process).
  if (f.totalCents > f.budgetCapCents) return reject(400, "OVER_BUDGET", "The total is over the budget cap.");

  // 9. Today's created links plus this total stay within the daily limit (UTC day). Other requests
  // still waiting on Visa (reserved) count too, so concurrent calls cannot all slip under the limit.
  const dayStart = new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const today = deps.db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS s FROM payments
    WHERE status IN ('link_created', 'reserved') AND created_at >= ? AND purchase_number != ?`)
    .get(dayStart, f.purchaseNumber) as { s: number };
  if (today.s + f.totalCents > deps.maxDailyCents) return reject(403, "DAILY_LIMIT", "The daily payment limit has been reached.");

  // 10. Call Visa; store the parsed result. The link is handed out only if the amount Visa will
  // charge is exactly the signed total (I2): a mismatch is recorded as failed.
  try {
    const { paymentLinkUrl, chargedCents, result } = await deps.createLink(req);
    if (chargedCents !== f.totalCents) {
      deps.db.prepare("UPDATE payments SET status = 'failed', result_json = ? WHERE purchase_number = ?")
        .run(JSON.stringify({ code: "AMOUNT_MISMATCH", chargedCents, result }), f.purchaseNumber);
      return err(502, "AMOUNT_MISMATCH", "Visa's payment page did not match the approved total, so it was not used.");
    }
    deps.db.prepare("UPDATE payments SET status = 'link_created', result_json = ? WHERE purchase_number = ?")
      .run(JSON.stringify(result), f.purchaseNumber);
    return { status: 200, body: { purchaseNumber: f.purchaseNumber, paymentLinkUrl } };
  } catch (e) {
    deps.db.prepare("UPDATE payments SET status = 'failed', result_json = ? WHERE purchase_number = ?")
      .run(JSON.stringify({ error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }), f.purchaseNumber);
    return err(502, "VISA_FAILED", "Visa could not create the payment link.");
  }
}
