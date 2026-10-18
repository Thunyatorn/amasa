import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cartHash, SignedFields, type StoreListing, type Verdict } from "@amasa/schemas";
import { verify } from "@amasa/verifier";
import { appendAudit } from "@amasa/audit";
import { getDb } from "../db";
import { getAutonomy } from "../db/autonomy";
import { clearApproval, getCart, setApproval } from "../db/carts";
import { getContract } from "../db/contracts";
import { getOptions } from "../db/options";
import { insertPurchase, spentThisWeekCents } from "../db/purchases";
import { env } from "../env";
import { ApiError } from "../http";
import { newPurchaseNumber } from "../purchase-number";
import { signVerdict, verifierKey } from "../sign";
import { fetchListing, fetchQuote } from "../store-client";

export const VerifyBody = z.strictObject({ cartId: z.string().uuid() });

export const VERDICT_TTL_MS = 5 * 60_000;

export interface VerifyResult {
  verdict: Verdict;
  approval: { approvalNonce: string; expiresAt: number } | null;
}

// Stage 6 (SPEC §9, §10.2). Fresh quote and listings from the store, autonomy read server-side
// (I7), pure verifier. On pass: sign the verdict server-side and issue a single-use nonce. The
// signature itself never goes to the browser.
export async function verifyCart(cartId: string): Promise<VerifyResult> {
  const db = getDb();
  const record = getCart(db, cartId);
  if (!record) throw new ApiError(404, "CART_NOT_FOUND", "That cart was not found.");
  const { cart } = record;
  const stored = getContract(db, cart.contractId);
  if (!stored) throw new ApiError(404, "CONTRACT_NOT_FOUND", "That contract was not found.");
  const { contract, contractHash } = stored;

  const quote = await fetchQuote(cart.lines);
  const listings: Record<string, StoreListing> = {};
  for (const sku of new Set(cart.lines.map((l) => l.sku))) {
    const listing = await fetchListing(sku);
    if (listing) listings[sku] = listing;
  }

  const now = Date.now();
  const autonomy = getAutonomy(db, contract.category);
  const verdict = verify({
    contract,
    storedContractHash: contractHash,
    cart,
    quote,
    listings,
    flaggedSkus: new Set(getOptions(db, contract.id)?.flaggedSkus ?? []),
    autonomy: { ...autonomy, spentThisWeekCents: spentThisWeekCents(db, contract.category, now) },
    tap: { required: env().TAP_ENABLED === "true", verified: false },
    now,
  });

  const purchaseNumber = newPurchaseNumber();
  const ts = new Date(now).toISOString();
  const codes = verdict.failures.map((f) => f.code);

  if (!verdict.pass || quote === null) {
    db.transaction(() => {
      clearApproval(db, cart.id);
      insertPurchase(db, { purchaseNumber, cartId: cart.id, contractId: contract.id, category: contract.category,
        status: "blocked", totalCents: verdict.totalCents, failureCodes: codes, now: ts });
      appendAudit(db, "verdict", { cartId: cart.id, purchaseNumber, pass: false, totalCents: verdict.totalCents, codes }, ts);
    }).immediate();
    return { verdict, approval: null };
  }

  const expiresAt = now + VERDICT_TTL_MS;
  const fields = SignedFields.parse({
    purchaseNumber,
    contractHash,
    cartHash: cartHash({ merchant: quote.merchant, currency: quote.currency, lines: quote.lines,
      taxCents: quote.taxCents, shippingCents: quote.shippingCents }),
    merchant: quote.merchant,
    category: contract.category,
    currency: quote.currency,
    totalCents: quote.totalCents,
    budgetCapCents: contract.budgetCapCents,
    expiresAt,
  });
  const signature = signVerdict(fields, verifierKey());
  const approvalNonce = randomBytes(32).toString("base64url");

  db.transaction(() => {
    setApproval(db, cart.id, fields, signature, quote, approvalNonce);
    insertPurchase(db, { purchaseNumber, cartId: cart.id, contractId: contract.id, category: contract.category,
      status: "verified", totalCents: quote.totalCents, failureCodes: [], now: ts });
    appendAudit(db, "verdict", { cartId: cart.id, purchaseNumber, pass: true, totalCents: quote.totalCents, codes: [] }, ts);
  }).immediate();

  return { verdict, approval: { approvalNonce, expiresAt } };
}
