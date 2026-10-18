// pnpm e2e:m5: the M5 acceptance checks over HTTP (BUILD_ORDER M5). Two live shopping runs (level 1
// one-tap, then level 0 after lowering); the demotion and the shoe return use fixed carts so they
// need no model. Needs `pnpm dev` or `pnpm --filter web start` (with the model variables) and
// `pnpm --filter payments dev`. Creates two sandbox payment links (a grocery order and $139.32).
import { randomUUID } from "node:crypto";
import { ContractDraft, Option, ProgressEvent } from "@amasa/schemas";
import { openDb } from "../lib/db";
import { insertDraft } from "../lib/db/drafts";
import { saveOptions } from "../lib/db/options";
import { databasePath } from "../lib/env";
import { seed } from "./seed";

const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const started = Date.now();
const at = () => `${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(7);
const cookies = new Map<string, string>();
let csrf = "";
const failures: string[] = [];
const check = (label: string, ok: boolean) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures.push(label); };

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}),
      cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair!.indexOf("=");
    cookies.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
  return res;
}
async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await request(method, path, body);
  const data: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.code ?? ""}: ${data?.message ?? ""}`);
  return data;
}
async function shop(contractId: string): Promise<ProgressEvent[]> {
  const res = await request("POST", "/api/shop", { contractId });
  if (!res.ok || !res.body) throw new Error(`POST /api/shop -> ${res.status}`);
  const events: ProgressEvent[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return events;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!block.startsWith("data: ")) continue;
      const event = ProgressEvent.parse(JSON.parse(block.slice(6)));
      events.push(event);
      if (event.type === "step" && !event.text.startsWith("Reading product pages (")) console.log(`${at()}    ${event.text}`);
      if (event.type === "error") console.log(`${at()}    error ${event.code}: ${event.message}`);
    }
  }
}
const autonomy = async (category: string) => (await call("GET", "/api/autonomy")).states.find((s: { category: string }) => s.category === category);
const db = () => openDb(databasePath());

// A confirmed contract with one fixed option, without a model (like pnpm e2e:hardcoded).
async function fixedCart(draft: ContractDraft, sku: string): Promise<{ cartId: string; contractId: string }> {
  const draftId = randomUUID();
  const handle = db();
  insertDraft(handle, draftId, draft, new Date().toISOString());
  handle.close();
  const { contract } = await call("POST", "/api/contracts", { draftId, draft });
  const option = Option.parse({ rank: 1, lines: [{ sku, qty: 1 }], reason: "Fixed test option.", estimate: { totalCents: 0, deliveryDays: 0, returnDays: 0 } });
  const handle2 = db();
  saveOptions(handle2, contract.id, [option], [], new Date().toISOString());
  handle2.close();
  const { cart } = await call("POST", "/api/carts", { contractId: contract.id, rank: 1 });
  return { cartId: cart.id, contractId: contract.id };
}

async function main(): Promise<void> {
  console.log(`web: ${WEB}`);
  const handle = db();
  seed(handle);
  handle.close();
  csrf = (await call("GET", "/api/csrf")).token;

  console.log(`\n${at()}  1. After pnpm seed, groceries offers level 1; accepting makes the next order one tap`);
  check("groceries shows a level-1 offer", (await autonomy("groceries")).offeredLevel === 1);
  await call("POST", "/api/autonomy", { category: "groceries", level: 1 });
  const intake = await call("POST", "/api/intake", { goal: "Rolled oats, under $20, must be returnable" });
  const { contract } = await call("POST", "/api/contracts", { draftId: intake.draftId, draft: { ...intake.draft, question: null },
    ...(intake.unsupported.length ? { acknowledgedUnsupported: true } : {}) });
  const first = await shop(contract.id);
  const prepared = first.find((e): e is Extract<ProgressEvent, { type: "prepared" }> => e.type === "prepared");
  check("the run arrives with rank 1 already verified (level 1)", !!prepared && prepared.level === 1 && prepared.verdict.pass && !!prepared.approval);
  if (prepared?.approval) {
    const paid = await call("POST", "/api/approve", { cartId: prepared.cartId, approvalNonce: prepared.approval.approvalNonce });
    check(`one tap (Approve) creates the payment page: ${paid.paymentLinkUrl.slice(0, 60)}…`, paid.paymentLinkUrl.startsWith("https://"));
  }

  console.log(`\n${at()}  2. Lowering takes one tap and the very next purchase asks for approval`);
  const lowered = await call("POST", "/api/autonomy", { category: "groceries", level: 0 });
  check("one call lowers groceries to level 0", lowered.state.level === 0);
  const second = await shop(contract.id);
  check("the next run prepares nothing: the shopper picks and approves", second.some((e) => e.type === "options") && !second.some((e) => e.type === "prepared"));

  console.log(`\n${at()}  3. An automatic demotion shows a notice saying what changed and why`);
  const handle3 = db();
  seed(handle3, "level2");
  handle3.close();
  await call("POST", "/api/autonomy", { category: "groceries", level: 2, weeklyCapCents: 100 });
  const groceries = ContractDraft.parse({ category: "groceries", goal: "rolled oats", quantity: 1, budgetCapCents: 2000,
    mustHave: [{ key: "type", op: "eq", value: "oats" }], allowedMerchants: ["demo-store"], minReturnDays: 14, question: null });
  const blockedCart = await fixedCart(groceries, "GROC-OATS-01");
  const blocked = await call("POST", "/api/verify", { cartId: blockedCart.cartId });
  check("the verifier blocks it (weekly limit $1.00)", !blocked.verdict.pass && blocked.verdict.failures.some((f: { code: string }) => f.code === "WEEKLY_CAP_EXCEEDED"));
  const notices: { text: string }[] = (await call("GET", "/api/notices")).notices;
  const demotion = notices.find((n) => n.text.startsWith("Groceries lowered from level 2"));
  check(`notice: "${demotion?.text ?? "none"}"`, !!demotion && demotion.text.includes("because a check failed: this order would go over your weekly limit"));
  check("groceries is now at level 1", (await autonomy("groceries")).level === 1);

  console.log(`\n${at()}  4. Returning a size-10.5 shoe as too small suggests size 11 with Keep / Forget`);
  const shoes = ContractDraft.parse({ category: "running-shoes", goal: "wide road running shoes, size 10.5", quantity: 1, budgetCapCents: 14000,
    mustHave: [{ key: "width", op: "eq", value: "wide" }, { key: "sizes_available", op: "includes", value: "10.5" }, { key: "use", op: "eq", value: "road" }],
    allowedMerchants: ["demo-store"], minReturnDays: 14, question: null });
  const shoeCart = await fixedCart(shoes, "SHOE-WIDE-01");
  const verified = await call("POST", "/api/verify", { cartId: shoeCart.cartId });
  if (!verified.verdict.pass) throw new Error("The shoe cart did not pass verification");
  const { purchaseNumber } = await call("POST", "/api/approve", { cartId: shoeCart.cartId, approvalNonce: verified.approval.approvalNonce });
  const outcome = await call("POST", "/api/outcomes", { purchaseNumber, outcome: "returned", reason: "too_small" });
  const suggestion = outcome.suggestions.find((s: { key: string }) => s.key === "size");
  check(`suggested size ${suggestion?.value} ("${suggestion?.note}")`, suggestion?.value === 11 && suggestion.status === "suggested");
  const receipt = await call("GET", `/api/purchases/${purchaseNumber}`);
  check("the receipt lists it for Keep / Forget", receipt.suggestions.some((s: { id: string }) => s.id === suggestion?.id));
  console.log(`         receipt: ${WEB}/receipt/${purchaseNumber}`);

  console.log(`\n${at()}  5–6. Every FailureCode has a sentence; Approve and Not now weigh the same: covered by pnpm test (m5-screens.test.ts)`);
  const audit = await call("GET", "/api/audit/verify");
  console.log(`\n${at()}  audit chain ${audit.ok ? "ok" : `BROKEN at ${audit.brokenAt}`} (${audit.length} entries)`);
  if (failures.length) throw new Error(`${failures.length} check(s) failed`);
  console.log("\ne2e:m5 passed");
}

main().catch((e: unknown) => {
  console.error(`\ne2e:m5 failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
