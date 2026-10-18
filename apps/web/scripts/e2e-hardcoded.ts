// pnpm e2e:hardcoded (M2): confirm a hard-coded contract for SHOE-WIDE-01, build a cart, verify
// it and approve it, printing the Visa sandbox payment link. No model calls.
// Needs both servers running: `pnpm dev` (web + mock store) and `pnpm --filter payments dev`.
import { randomUUID } from "node:crypto";
import { ContractDraft, Option, Quote } from "@amasa/schemas";
import { openDb } from "../lib/db";
import { insertDraft } from "../lib/db/drafts";
import { saveOptions } from "../lib/db/options";
import { databasePath } from "../lib/env";

const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const STORE = process.env.STORE_BASE_URL || `${WEB}/api/store`;
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

const cookies = new Map<string, string>();
let csrf = "";

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair!.indexOf("=");
    cookies.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.code ?? ""}: ${data?.message ?? ""}`);
  return data;
}

async function main(): Promise<void> {
  console.log(`web: ${WEB}`);
  csrf = (await call("GET", "/api/csrf")).token;

  // 1. Store the hard-coded draft (intake would write it, M3) and confirm it (SPEC §17.2: wide road
  // shoe, size 10.5, $140.00, 14-day returns).
  const draft = ContractDraft.parse({
    category: "running-shoes",
    goal: "wide running shoes for a half marathon, size 10.5, under $140, must be returnable",
    quantity: 1,
    budgetCapCents: 14000,
    mustHave: [
      { key: "width", op: "eq", value: "wide" },
      { key: "sizes_available", op: "includes", value: "10.5" },
      { key: "use", op: "eq", value: "road" },
    ],
    allowedMerchants: ["demo-store"],
    minReturnDays: 14,
    question: null,
  });
  const draftId = randomUUID();
  const draftDb = openDb(databasePath());
  insertDraft(draftDb, draftId, draft, new Date().toISOString());
  draftDb.close();
  const { contract, contractHash } = await call("POST", "/api/contracts", { draftId, draft });
  console.log(`1. contract confirmed  ${contract.id}  hash ${contractHash.slice(0, 12)}…`);

  // 2. Seed the one hard-coded option (in M4 the shopping run writes this).
  const qres = await fetch(`${STORE}/quote`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines: [{ sku: "SHOE-WIDE-01", qty: 1 }] }) });
  const q = Quote.parse(await qres.json());
  const option = Option.parse({
    rank: 1,
    lines: [{ sku: "SHOE-WIDE-01", qty: 1 }],
    reason: "Hard-coded M2 test option: wide road shoe in size 10.5.",
    estimate: { totalCents: q.totalCents, deliveryDays: q.lines[0]!.deliveryDays, returnDays: q.lines[0]!.returnDays },
  });
  const db = openDb(databasePath());
  saveOptions(db, contract.id, [option], [], new Date().toISOString());
  db.close();
  console.log(`2. option seeded       SHOE-WIDE-01  estimate ${dollars(option.estimate.totalCents)}`);

  // 3. Build the cart from rank 1.
  const { cart } = await call("POST", "/api/carts", { contractId: contract.id, rank: 1 });
  console.log(`3. cart created        ${cart.id}`);

  // 4. Verify.
  const { verdict, approval } = await call("POST", "/api/verify", { cartId: cart.id });
  console.log(`4. verdict             ${verdict.pass ? "PASS" : "BLOCKED"}  total ${dollars(verdict.totalCents)}`);
  if (!verdict.pass || !approval) {
    for (const f of verdict.failures) console.log(`     ${f.code}: ${f.detail}`);
    throw new Error("The cart did not pass verification");
  }

  // 5. Approve: the server sends the signed request to the payments service, which calls Visa.
  const { purchaseNumber, paymentLinkUrl } = await call("POST", "/api/approve", { cartId: cart.id, approvalNonce: approval.approvalNonce });
  console.log(`5. approved            purchase ${purchaseNumber}`);

  if (verdict.totalCents !== 13932) throw new Error(`Expected $139.32, got ${dollars(verdict.totalCents)}`);
  const audit = await call("GET", "/api/audit/verify");
  console.log(`\nAudit chain: ${audit.ok ? "ok" : `BROKEN at seq ${audit.brokenAt}`} (${audit.length} entries)`);
  console.log(`\nSandbox payment link for ${dollars(verdict.totalCents)}:\n${paymentLinkUrl}`);
}

main().catch((e: unknown) => {
  console.error(`\ne2e:hardcoded failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
