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
import { chainHead } from "@amasa/audit";
import { getAutonomyState } from "../db/autonomy";
import { unseenNotices } from "../db/notices";
import { getPurchase } from "../db/purchases";
import { listProfileEntries } from "../db/profile";
import { newSessionValue } from "../session";
import { recordOutcome } from "./outcome-stage";
import { prepareStage } from "./prepare-stage";
import type { Option, ProgressEvent } from "@amasa/schemas";
import { GET as purchaseGet } from "../../app/api/purchases/[purchaseNumber]/route";
import { GET as auditGet } from "../../app/api/audit/route";
import { DELETE as meDelete } from "../../app/api/me/route";
import { POST as editPost } from "../../app/api/contracts/[id]/edit/route";
import { POST as outcomePost } from "../../app/api/outcomes/route";
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

function freshCart(): { cartId: string; contractId: string } {
  const draftId = randomUUID();
  insertDraft(getDb(), draftId, draft, new Date().toISOString());
  const { contract } = confirmContract({ draftId, draft });
  saveOptions(getDb(), contract.id, [{ rank: 1, lines: [{ sku: "SHOE-WIDE-01", qty: 1 }], reason: "test",
    estimate: { totalCents: 13932, deliveryDays: 3, returnDays: 30 } }], [], new Date().toISOString());
  return { cartId: createCart(contract.id, 1).id, contractId: contract.id };
}
async function linkedPurchase(): Promise<{ purchaseNumber: string; contractId: string }> {
  const { cartId, contractId } = freshCart();
  const { approval } = await verifyCart(cartId);
  const { purchaseNumber } = await approveCart(cartId, approval!.approvalNonce);
  return { purchaseNumber, contractId };
}
const setLevel = (level: number, weeklyCapCents = 0) => getDb().prepare("INSERT OR REPLACE INTO autonomy (category, json) VALUES ('running-shoes', ?)")
  .run(JSON.stringify({ category: "running-shoes", level, offeredLevel: null, consecutiveGood: 3, weeklyCapCents, updatedAt: new Date().toISOString() }));
const code = async (p: Promise<unknown> | (() => unknown)) => {
  try { await (typeof p === "function" ? p() : p); return "OK"; } catch (e) { return e instanceof ApiError ? `${e.status} ${e.code}` : String(e); }
};
const req = (method: string, body?: unknown) => new Request("http://localhost/api/x", { method,
  headers: { cookie: `amasa_session=${newSessionValue()}; amasa_csrf=token`, "x-csrf-token": "token", "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const clean = () => { for (const t of ["autonomy", "notices", "profile_entries", "purchases"]) getDb().prepare(`DELETE FROM ${t}`).run(); };

afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { store.unitCents = 12900; payCalls.length = 0; clean(); });

describe("verifier blocks demote autonomy (SPEC §11)", () => {
  it("a block lowers the level by one, says why in a notice, and is audited with the blocked purchase", async () => {
    setLevel(2, 10_000);
    const { verdict } = await verifyCart(freshCart().cartId);
    expect(verdict.failures.map((f) => f.code)).toEqual(["WEEKLY_CAP_EXCEEDED"]);
    expect(getAutonomyState(getDb(), "running-shoes")).toMatchObject({ level: 1, consecutiveGood: 0, offeredLevel: null });
    expect(unseenNotices(getDb()).map((n) => n.text)).toEqual(["Running shoes lowered from level 2 (Prepare) to level 1 (Propose) because a check failed: this order would go over your weekly limit."]);
    const last = getDb().prepare("SELECT type, payload FROM audit ORDER BY seq DESC LIMIT 2").all() as { type: string; payload: string }[];
    expect(last.map((r) => r.type)).toEqual(["autonomy_changed", "verdict"]);
    expect(verifyAudit(getDb()).ok).toBe(true);
  });
  it("uses the plain sentence for the first failed check", async () => {
    setLevel(1); store.unitCents = 15900;
    await verifyCart(freshCart().cartId);
    expect(unseenNotices(getDb())[0]!.text).toContain("because a check failed: the total, including tax and shipping, is over your budget.");
  });
});

describe("receipt data and outcomes (SPEC §5, §12, §13)", () => {
  it("stores the audit head at purchase time and serves the receipt", async () => {
    const { purchaseNumber } = await linkedPurchase();
    const head = chainHead(getDb());
    const record = getPurchase(getDb(), purchaseNumber)!;
    expect(record.auditHead).toBe(head);
    expect(record.brands).toEqual(["Stride"]);
    const res = await purchaseGet(req("GET"), { params: Promise.resolve({ purchaseNumber }) });
    const body = await res.json();
    expect(body).toMatchObject({ purchase: { status: "link_created", totalCents: 13932 }, auditHead: head,
      totals: { subtotalCents: 12900, taxCents: 1032, shippingCents: 0, totalCents: 13932 },
      lines: [{ sku: "SHOE-WIDE-01", title: "Stride Wide Road Running Shoe", qty: 1, unitCents: 12900 }] });
    expect(body.returnBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returning a size-10.5 shoe as too small suggests size 11 with a code-written note and notice", async () => {
    const { purchaseNumber } = await linkedPurchase();
    const result = recordOutcome({ purchaseNumber, outcome: "returned", reason: "too_small" });
    expect(result.purchase.status).toBe("returned");
    expect(result.suggestions).toEqual([expect.objectContaining({ category: "running-shoes", key: "size", value: 11, source: "returned",
      status: "suggested", note: "You returned size 10.5 as too small" })]);
    expect(unseenNotices(getDb()).map((n) => n.text)).toContain("Amasa suggests running shoes size 11 because you returned size 10.5 as too small. Keep or forget it on your receipt or in Settings.");
    expect(await code(() => recordOutcome({ purchaseNumber, outcome: "kept" }))).toBe("409 OUTCOME_NOT_ALLOWED");
    const audit = getDb().prepare("SELECT type FROM audit ORDER BY seq DESC LIMIT 3").all() as { type: string }[];
    expect(audit.map((r) => r.type)).toEqual(["profile_changed", "outcome_recorded", "payment_link_created"]);
    expect(verifyAudit(getDb()).ok).toBe(true);
  });

  it("too large suggests half a size down, and the same suggestion is never made twice", async () => {
    const first = await linkedPurchase();
    expect(recordOutcome({ purchaseNumber: first.purchaseNumber, outcome: "returned", reason: "too_large" }).suggestions[0]).toMatchObject({ value: 10 });
    const second = await linkedPurchase();
    expect(recordOutcome({ purchaseNumber: second.purchaseNumber, outcome: "returned", reason: "too_large" }).suggestions).toEqual([]);
  });

  it("kept twice for the same brand suggests brand_like; kept counts toward an offer", async () => {
    const one = await linkedPurchase();
    expect(recordOutcome({ purchaseNumber: one.purchaseNumber, outcome: "kept" }).suggestions).toEqual([]);
    const two = await linkedPurchase();
    const result = recordOutcome({ purchaseNumber: two.purchaseNumber, outcome: "kept" });
    expect(result.suggestions).toEqual([expect.objectContaining({ key: "brand_like", value: "Stride", note: "You kept Stride 2 times" })]);
    expect(result.autonomy).toMatchObject({ consecutiveGood: 2 });
  });

  it("returned as not as described demotes; twice for a brand suggests brand_avoid", async () => {
    setLevel(1);
    const one = await linkedPurchase();
    expect(recordOutcome({ purchaseNumber: one.purchaseNumber, outcome: "returned", reason: "not_as_described" }).autonomy).toMatchObject({ level: 0 });
    const two = await linkedPurchase();
    expect(recordOutcome({ purchaseNumber: two.purchaseNumber, outcome: "returned", reason: "not_as_described" }).suggestions)
      .toEqual([expect.objectContaining({ key: "brand_avoid", value: "Stride" })]);
  });

  it("refuses outcomes before a payment link and checks the reason rule", async () => {
    const { cartId } = freshCart();
    const { approval } = await verifyCart(cartId);
    const verified = getDb().prepare("SELECT purchase_number FROM purchases WHERE status = 'verified'").get() as { purchase_number: string };
    expect(await code(() => recordOutcome({ purchaseNumber: verified.purchase_number, outcome: "kept" }))).toBe("409 OUTCOME_NOT_ALLOWED");
    expect(approval).not.toBeNull();
    expect(await code(() => recordOutcome({ purchaseNumber: verified.purchase_number, outcome: "kept", reason: "other" } as never))).toBe("400 INVALID_REQUEST");
    expect(await code(() => recordOutcome({ purchaseNumber: verified.purchase_number, outcome: "returned" }))).toBe("400 INVALID_REQUEST");
    expect((await outcomePost(req("POST", { purchaseNumber: verified.purchase_number, outcome: "kept", extra: 1 }))).status).toBe(400);
  });
});

describe("history, delete-all and edit-the-rule", () => {
  it("DELETE /api/me removes personal records and keeps a verifiable, erased audit chain", async () => {
    await linkedPurchase();
    const before = (await (await auditGet(req("GET"))).json()) as { check: { ok: boolean; length: number }; entries: { erased: boolean }[] };
    expect(before.check.ok).toBe(true);
    expect((await meDelete(req("DELETE"))).status).toBe(200);
    for (const t of ["contracts", "carts", "purchases", "profile_entries", "autonomy", "notices", "options"]) {
      expect((getDb().prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);
    }
    const after = (await (await auditGet(req("GET"))).json()) as { check: { ok: boolean; length: number }; entries: { erased: boolean }[] };
    expect(after.check).toMatchObject({ ok: true, length: before.check.length });
    expect(after.entries.every((e) => e.erased)).toBe(true);
  });

  it("Edit the rule copies a contract into a new draft", async () => {
    const { contractId } = freshCart();
    const res = await editPost(req("POST"), { params: Promise.resolve({ id: contractId }) });
    const { draftId } = await res.json();
    const row = getDb().prepare("SELECT json FROM contract_drafts WHERE id = ?").get(draftId) as { json: string };
    expect(JSON.parse(row.json)).toMatchObject({ budgetCapCents: 14000, mustHave: draft.mustHave, question: null });
    expect((await editPost(req("POST"), { params: Promise.resolve({ id: randomUUID() }) })).status).toBe(404);
    expect(listProfileEntries(getDb())).toEqual([]);
  });
});

describe("level 1 and level 2 preparation (SPEC §5, §11)", () => {
  function contractWithOptions(): { contract: Parameters<typeof prepareStage>[0]; options: Option[] } {
    const draftId = randomUUID();
    insertDraft(getDb(), draftId, draft, new Date().toISOString());
    const { contract } = confirmContract({ draftId, draft });
    const options: Option[] = [{ rank: 1, lines: [{ sku: "SHOE-WIDE-01", qty: 1 }], reason: "test", estimate: { totalCents: 13932, deliveryDays: 3, returnDays: 30 } }];
    saveOptions(getDb(), contract.id, options, [], new Date().toISOString());
    return { contract, options };
  }
  const run = async () => {
    const events: ProgressEvent[] = [];
    const { contract, options } = contractWithOptions();
    await prepareStage(contract, options, (e) => events.push(e), new AbortController().signal);
    return events;
  };

  it("does nothing at level 0", async () => {
    expect(await run()).toEqual([]);
    expect(payCalls).toHaveLength(0);
  });

  it("level 1 verifies rank 1 so one tap approves it, and never pays by itself", async () => {
    setLevel(1);
    const events = await run();
    expect(events).toEqual([expect.objectContaining({ type: "prepared", level: 1, rank: 1, verdict: expect.objectContaining({ pass: true, totalCents: 13932 }),
      approval: expect.objectContaining({ approvalNonce: expect.any(String) }), payment: null })]);
    expect(payCalls).toHaveLength(0);
    const prepared = events[0] as Extract<ProgressEvent, { type: "prepared" }>;
    expect((await approveCart(prepared.cartId, prepared.approval!.approvalNonce)).paymentLinkUrl).toContain("https://");
  });

  it("level 2 prepares the payment link within the weekly limit and says so", async () => {
    setLevel(2, 15_000);
    const events = await run();
    expect(events.map((e) => e.type)).toEqual(["step", "prepared"]);
    expect(events[0]).toEqual({ type: "step", text: "Ready to pay: one tap" });
    expect(events[1]).toMatchObject({ level: 2, approval: null, payment: { purchaseNumber: expect.stringMatching(/^[A-Z0-9]{16}$/), paymentLinkUrl: expect.stringContaining("https://") } });
    expect(payCalls).toHaveLength(1);
  });

  it("level 2 over the weekly limit is blocked by the verifier, demoted, and does not pay", async () => {
    setLevel(2, 10_000);
    const events = await run();
    expect(events).toEqual([expect.objectContaining({ type: "prepared", level: 2, verdict: expect.objectContaining({ pass: false }), approval: null, payment: null })]);
    expect(payCalls).toHaveLength(0);
    expect(getAutonomyState(getDb(), "running-shoes").level).toBe(1);
  });

  it("does nothing when the run was cancelled or there are no options", async () => {
    setLevel(2, 15_000);
    const { contract, options } = contractWithOptions();
    const events: ProgressEvent[] = [];
    const cancelled = new AbortController(); cancelled.abort();
    await prepareStage(contract, options, (e) => events.push(e), cancelled.signal);
    await prepareStage(contract, [], (e) => events.push(e), new AbortController().signal);
    expect(events).toEqual([]);
    expect(payCalls).toHaveLength(0);
  });
});
