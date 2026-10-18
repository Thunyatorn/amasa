import { randomUUID, createPublicKey, verify as edVerify } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canon, priceLines, type Quote, type StoreListing } from "@amasa/schemas";
import { verifyAudit } from "@amasa/audit";

// Environment first (env() and getDb() read it lazily).
const { dir } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const { generateKeyPairSync } = require("node:crypto") as typeof import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "amasa-stages-"));
  const kp = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  process.env.DATABASE_PATH = join(dir, "test.db");
  process.env.SESSION_SECRET = "s".repeat(43);
  process.env.VERIFIER_PRIVATE_KEY_B64 = Buffer.from(kp.privateKey).toString("base64");
  process.env.TEST_VERIFIER_PUBLIC_PEM = kp.publicKey;
  return { dir };
});

// The store and the payments service are external systems: mock their clients.
const listing: StoreListing = {
  merchant: "demo-store", sku: "SHOE-WIDE-01", title: "Stride Wide Road Running Shoe", brand: "Stride", category: "running-shoes",
  unitCents: 12900, returnDays: 30, deliveryDays: 3, stock: 12, rating: 4.6, reviewCount: 214, sponsored: false,
  attributes: { width: "wide", sizes_available: "8,9,10,10.5,11", use: "road" },
};
const store = vi.hoisted(() => ({ unitCents: 12900 }));
vi.mock("../store-client", () => ({
  fetchListing: async () => listing,
  fetchQuote: async (lines: Array<{ sku: string; qty: number }>): Promise<Quote> => {
    const p = priceLines([{ unitCents: store.unitCents, qty: lines[0]!.qty }], { taxRateBps: 800, freeShippingOverCents: 10000, flatShippingCents: 599 });
    return { quoteId: "q", merchant: "demo-store", currency: "USD",
      lines: [{ sku: "SHOE-WIDE-01", title: listing.title, qty: lines[0]!.qty, unitCents: store.unitCents, lineCents: store.unitCents * lines[0]!.qty, returnDays: 30, deliveryDays: 3 }],
      ...p, quotedAt: Date.now() };
  },
}));
const payCalls = vi.hoisted(() => [] as unknown[]);
vi.mock("../payments-client", () => ({
  requestPaymentLink: async (req: { fields: { purchaseNumber: string } }) => {
    payCalls.push(req);
    return { ok: true, paymentLinkUrl: `https://ebc2test.cybersource.com/ebc2/payByLink/pay/${req.fields.purchaseNumber}` };
  },
}));

import { getDb } from "../db";
import { insertDraft } from "../db/drafts";
import { saveOptions } from "../db/options";
import { ApiError } from "../http";
import { approveCart } from "./approve-stage";
import { createCart } from "./cart-stage";
import { confirmContract } from "./contract-stage";
import { verifyCart } from "./verify-stage";

const draft = {
  category: "running-shoes" as const, goal: "wide road shoes", quantity: 1, budgetCapCents: 14000,
  mustHave: [{ key: "width", op: "eq" as const, value: "wide" }, { key: "sizes_available", op: "includes" as const, value: "10.5" }],
  allowedMerchants: ["demo-store"], minReturnDays: 14, question: null,
};

function freshCart(): string {
  const draftId = randomUUID();
  insertDraft(getDb(), draftId, draft, new Date().toISOString());
  const { contract } = confirmContract({ draftId, draft });
  saveOptions(getDb(), contract.id, [{ rank: 1, lines: [{ sku: "SHOE-WIDE-01", qty: 1 }], reason: "test",
    estimate: { totalCents: 13932, deliveryDays: 3, returnDays: 30 } }], [], new Date().toISOString());
  return createCart(contract.id, 1).id;
}

const code = async (p: Promise<unknown>) => {
  try { await p; return "OK"; } catch (e) { return e instanceof ApiError ? `${e.status} ${e.code}` : String(e); }
};

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("contracts, carts, verify and approve stages", () => {
  beforeEach(() => { payCalls.length = 0; store.unitCents = 12900; });

  it("contract confirmation rejects open questions, missing budgets and unknown stores", async () => {
    expect(await code(Promise.resolve().then(() => confirmContract({ draftId: randomUUID(), draft: { ...draft, question: "Which size?" } })))).toBe("400 DRAFT_HAS_QUESTION");
    expect(await code(Promise.resolve().then(() => confirmContract({ draftId: randomUUID(), draft: { ...draft, budgetCapCents: null } })))).toBe("400 BUDGET_REQUIRED");
    expect(await code(Promise.resolve().then(() => confirmContract({ draftId: randomUUID(), draft: { ...draft, allowedMerchants: ["evil-store"] } })))).toBe("400 UNKNOWN_MERCHANT");
  });

  it("a passing cart gets a verdict signed with the verifier key over canon(SignedFields)", async () => {
    const cartId = freshCart();
    const { verdict, approval } = await verifyCart(cartId);
    expect(verdict).toEqual({ pass: true, totalCents: 13932, failures: [] });
    expect(approval!.approvalNonce.length).toBeGreaterThanOrEqual(43);
    const row = getDb().prepare("SELECT signed_fields, signature FROM carts WHERE id = ?").get(cartId) as { signed_fields: string; signature: string };
    const fields = JSON.parse(row.signed_fields);
    expect(fields).toMatchObject({ totalCents: 13932, budgetCapCents: 14000, merchant: "demo-store", currency: "USD", expiresAt: approval!.expiresAt });
    const pub = createPublicKey(process.env.TEST_VERIFIER_PUBLIC_PEM!);
    expect(edVerify(null, Buffer.from(canon(fields)), pub, Buffer.from(row.signature, "base64"))).toBe(true);
  });

  it("approve consumes the nonce once: a second approve is 409 and payments is called once", async () => {
    const cartId = freshCart();
    const { approval } = await verifyCart(cartId);
    const r = await approveCart(cartId, approval!.approvalNonce);
    expect(r.paymentLinkUrl).toContain("https://");
    expect(await code(approveCart(cartId, approval!.approvalNonce))).toBe("409 NOT_VERIFIED");
    expect(payCalls).toHaveLength(1);
    const status = getDb().prepare("SELECT status, payment_link_url FROM purchases WHERE purchase_number = ?").get(r.purchaseNumber);
    expect(status).toEqual({ status: "link_created", payment_link_url: r.paymentLinkUrl });
  });

  it("a wrong nonce is rejected and does not reach payments", async () => {
    const cartId = freshCart();
    await verifyCart(cartId);
    expect(await code(approveCart(cartId, "wrong-nonce"))).toBe("409 NONCE_INVALID");
    expect(payCalls).toHaveLength(0);
  });

  it("an approval older than 5 minutes is rejected (re-verify required)", async () => {
    const cartId = freshCart();
    const { approval } = await verifyCart(cartId);
    expect(await code(approveCart(cartId, approval!.approvalNonce, approval!.expiresAt + 1))).toBe("409 VERDICT_EXPIRED");
    expect(payCalls).toHaveLength(0);
  });

  it("an over-budget cart is blocked, records its codes, and cannot be approved", async () => {
    store.unitCents = 13500; // $135.00 + tax = $145.80 > $140.00
    const cartId = freshCart();
    const { verdict, approval } = await verifyCart(cartId);
    expect(verdict.pass).toBe(false);
    expect(verdict.failures.map((f) => f.code)).toEqual(["OVER_BUDGET"]);
    expect(approval).toBeNull();
    const row = getDb().prepare("SELECT status, failure_codes FROM purchases WHERE cart_id = ?").get(cartId);
    expect(row).toEqual({ status: "blocked", failure_codes: '["OVER_BUDGET"]' });
    expect(await code(approveCart(cartId, "anything"))).toBe("409 NOT_VERIFIED");
    expect(payCalls).toHaveLength(0);
  });

  it("I7: approve re-reads autonomy; at level 2 the weekly cap counts in-flight and created links", async () => {
    const setLevel = (level: number, cap: number) => getDb().prepare("INSERT OR REPLACE INTO autonomy (category, json) VALUES ('running-shoes', ?)")
      .run(JSON.stringify({ category: "running-shoes", level, offeredLevel: null, consecutiveGood: 0, weeklyCapCents: cap, updatedAt: new Date().toISOString() }));
    getDb().prepare("DELETE FROM purchases WHERE status IN ('approved', 'link_created')").run(); // isolate from earlier tests
    const first = freshCart();
    const second = freshCart();
    setLevel(2, 13932 * 2 - 1); // room for exactly one $139.32 order
    const a1 = (await verifyCart(first)).approval!;
    const a2 = (await verifyCart(second)).approval!;
    await approveCart(first, a1.approvalNonce);
    expect(await code(approveCart(second, a2.approvalNonce))).toBe("409 WEEKLY_CAP_EXCEEDED");
    expect(payCalls).toHaveLength(1);
    setLevel(0, 0); // lowering the level takes effect on the very next approve (I7)
    expect((await approveCart(second, a2.approvalNonce)).paymentLinkUrl).toContain("https://");
    getDb().prepare("DELETE FROM autonomy").run();
  });

  it("every step above left a verifiable audit chain", () => {
    const check = verifyAudit(getDb());
    expect(check.ok).toBe(true);
    expect(check.length).toBeGreaterThan(10);
  });
});
