import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { canon } from "@amasa/schemas/canon";
import { cartHash } from "@amasa/schemas/cart-hash";
import { openPaymentsDb } from "./db";
import { handlePay, type PayDeps } from "./pay";
import type { PaymentRequest, SignedFields } from "./schema";

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const keys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const signWith = (f: SignedFields, key: KeyObject) => sign(null, Buffer.from(canon(f)), key).toString("base64");

// A SHOE-WIDE-01 payment: $129.00 + $10.32 tax, free shipping = $139.32.
function request(over: { fields?: Partial<SignedFields>; key?: KeyObject } = {}): PaymentRequest {
  const lines = [{ sku: "SHOE-WIDE-01", title: "Stride Wide Road Running Shoe", qty: 1, unitCents: 12900 }];
  const fields: SignedFields = {
    purchaseNumber: "ABCDEF0123456789",
    contractHash: "c".repeat(64),
    cartHash: cartHash({ merchant: "demo-store", currency: "USD", lines, taxCents: 1032, shippingCents: 0 }),
    merchant: "demo-store",
    category: "running-shoes",
    currency: "USD",
    totalCents: 13932,
    budgetCapCents: 14000,
    expiresAt: NOW + 5 * 60_000,
    ...over.fields,
  };
  return { fields, signature: signWith(fields, over.key ?? keys.privateKey), lines, taxCents: 1032, shippingCents: 0 };
}

describe("POST /pay checks (SPEC §10.3)", () => {
  let deps: PayDeps;
  let visaCalls: PaymentRequest[];
  let clock: number;
  let visaFails: boolean;
  let visaChargesCents: number | null; // null = Visa charges exactly the requested total

  beforeEach(() => {
    visaCalls = [];
    clock = NOW;
    visaFails = false;
    visaChargesCents = null;
    deps = {
      db: openPaymentsDb(":memory:"),
      publicKey: keys.publicKey,
      maxDailyCents: 50_000,
      now: () => clock,
      createLink: async (req) => {
        visaCalls.push(req);
        if (visaFails) throw new Error("Failed to create payment link");
        return { paymentLinkUrl: "https://ebc2test.cybersource.com/ebc2/payByLink/pay/test",
          chargedCents: visaChargesCents ?? req.fields.totalCents, result: { id: req.fields.purchaseNumber } };
      },
    };
  });

  const status = (pn = "ABCDEF0123456789") =>
    (deps.db.prepare("SELECT status FROM payments WHERE purchase_number = ?").get(pn) as { status: string } | undefined)?.status;

  it("a valid signed request creates one link for $139.32", async () => {
    const r = await handlePay(request(), deps);
    expect(r).toEqual({ status: 200, body: { purchaseNumber: "ABCDEF0123456789", paymentLinkUrl: "https://ebc2test.cybersource.com/ebc2/payByLink/pay/test" } });
    expect(visaCalls).toHaveLength(1);
    expect(visaCalls[0]!.fields.totalCents).toBe(13932);
    expect(status()).toBe("link_created");
  });

  it("acceptance: the same signed request twice gets 409 the second time, and Visa is called once", async () => {
    const req = request();
    expect((await handlePay(req, deps)).status).toBe(200);
    const second = await handlePay(structuredClone(req), deps);
    expect(second).toEqual({ status: 409, body: { code: "DUPLICATE_PURCHASE", message: "This purchase was already submitted." } });
    expect(visaCalls).toHaveLength(1);
  });

  it("acceptance: editing one line's unitCents makes /pay reject it, with no Visa call", async () => {
    const req = request();
    req.lines[0]!.unitCents = 1;
    const r = await handlePay(req, deps);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: "CART_HASH_MISMATCH" });
    expect(visaCalls).toHaveLength(0);
    expect(status()).toBe("rejected");
  });

  it("acceptance: a verdict older than 5 minutes is rejected, with no Visa call", async () => {
    const req = request(); // expiresAt = signing time + 5 min
    clock = NOW + 5 * 60_000 + 1;
    const r = await handlePay(req, deps);
    expect(r).toMatchObject({ status: 403, body: { code: "VERDICT_EXPIRED" } });
    expect(visaCalls).toHaveLength(0);
    expect(status()).toBeUndefined(); // rejected before the reservation
  });

  it("exactly at expiresAt is still accepted", async () => {
    clock = NOW + 5 * 60_000;
    expect((await handlePay(request(), deps)).status).toBe(200);
  });

  it("a signature from another key is rejected before reserving", async () => {
    const r = await handlePay(request({ key: otherKeys.privateKey }), deps);
    expect(r).toMatchObject({ status: 403, body: { code: "BAD_SIGNATURE" } });
    expect(visaCalls).toHaveLength(0);
    expect(status()).toBeUndefined();
  });

  it("editing a signed field (the total) breaks the signature", async () => {
    const req = request();
    req.fields.totalCents = 100;
    expect(await handlePay(req, deps)).toMatchObject({ status: 403, body: { code: "BAD_SIGNATURE" } });
    expect(visaCalls).toHaveLength(0);
  });

  it("garbage signature text is rejected, not thrown", async () => {
    const req = request();
    req.signature = "not base64 !!";
    expect((await handlePay(req, deps)).status).toBe(403);
  });

  it("changing tax without changing the cart hash is rejected", async () => {
    const req = request();
    req.taxCents = 0;
    expect(await handlePay(req, deps)).toMatchObject({ status: 400, body: { code: "CART_HASH_MISMATCH" } });
    expect(visaCalls).toHaveLength(0);
  });

  it("a signed total that does not equal lines + tax + shipping is rejected", async () => {
    const r = await handlePay(request({ fields: { totalCents: 13933 } }), deps);
    expect(r).toMatchObject({ status: 400, body: { code: "TOTAL_MISMATCH" } });
    expect(visaCalls).toHaveLength(0);
  });

  it("a signed total over the budget cap is rejected (I3, second process)", async () => {
    const r = await handlePay(request({ fields: { budgetCapCents: 13931 } }), deps);
    expect(r).toMatchObject({ status: 400, body: { code: "OVER_BUDGET" } });
    expect(visaCalls).toHaveLength(0);
  });

  it("the daily limit counts today's created links", async () => {
    deps.maxDailyCents = 13932 * 2 - 1;
    expect((await handlePay(request({ fields: { purchaseNumber: "AAAAAAAAAAAAAAA1" } }), deps)).status).toBe(200);
    const r = await handlePay(request({ fields: { purchaseNumber: "AAAAAAAAAAAAAAA2" } }), deps);
    expect(r).toMatchObject({ status: 403, body: { code: "DAILY_LIMIT" } });
    expect(visaCalls).toHaveLength(1);
  });

  it("a Visa failure marks the payment failed and returns 502", async () => {
    visaFails = true;
    expect(await handlePay(request(), deps)).toMatchObject({ status: 502, body: { code: "VISA_FAILED" } });
    expect(status()).toBe("failed");
  });

  it("a link whose Visa amount differs from the signed total is not handed out (M2 finding: $129 vs $139.32)", async () => {
    visaChargesCents = 12900;
    const r = await handlePay(request(), deps);
    expect(r).toMatchObject({ status: 502, body: { code: "AMOUNT_MISMATCH" } });
    expect(JSON.stringify(r.body)).not.toContain("https://");
    expect(status()).toBe("failed");
  });

  it("requests still waiting on Visa count toward the daily limit", async () => {
    deps.maxDailyCents = 13932 * 2 - 1;
    deps.db.prepare("INSERT INTO payments (purchase_number, status, total_cents, result_json, created_at) VALUES ('BBBBBBBBBBBBBBB1', 'reserved', 13932, NULL, ?)")
      .run(new Date(NOW).toISOString());
    const r = await handlePay(request(), deps);
    expect(r).toMatchObject({ status: 403, body: { code: "DAILY_LIMIT" } });
    expect(visaCalls).toHaveLength(0);
  });

  it("unknown keys and malformed bodies are rejected before anything else", async () => {
    expect((await handlePay({ ...request(), extra: 1 }, deps)).status).toBe(400);
    expect((await handlePay(null, deps)).status).toBe(400);
    expect((await handlePay({ fields: {} }, deps)).status).toBe(400);
    expect(visaCalls).toHaveLength(0);
  });
});
