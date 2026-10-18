// pnpm e2e:shop (M4 gate): the personalized happy path over HTTP, ending in a sandbox payment link.
// seed profile → intake → confirm → shopping run (streamed) → cart for the top option → verify →
// approve. Needs `pnpm dev` (with the model variables) and `pnpm --filter payments dev` running.
import { ProgressEvent } from "@amasa/schemas";
import { openDb } from "../lib/db";
import { databasePath } from "../lib/env";
import { seed } from "./seed";

const WEB = process.env.WEB_URL || "http://127.0.0.1:3000";
const GOAL = process.env.E2E_GOAL || "Road running shoes for a half marathon, under $140, must be returnable";
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
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
      if (event.type === "step") console.log(`${at()}  ${event.text}`);
      else if (event.type === "flagged") console.log(`${at()}  flagged ${event.sku}: ${event.reason}`);
      else if (event.type === "filtered") console.log(`${at()}  filtered ${event.removed.map((r) => `${r.code} ${r.count}`).join(", ")}`);
      else if (event.type === "error") console.log(`${at()}  error ${event.code}: ${event.message}`);
      else if (event.type === "options") for (const o of event.options) console.log(`${at()}  option ${o.rank}: ${o.lines.map((l) => l.sku).join("+")} ${dollars(o.estimate.totalCents)} "${o.reason}"`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`web: ${WEB}\ngoal: ${GOAL}`);
  const db = openDb(databasePath());
  seed(db);
  db.close();
  csrf = (await call("GET", "/api/csrf")).token;

  const intake = await call("POST", "/api/intake", { goal: GOAL });
  console.log(`${at()}  draft: budget ${intake.draft.budgetCapCents}, rules ${JSON.stringify(intake.draft.mustHave)}`);
  const { contract } = await call("POST", "/api/contracts", { draftId: intake.draftId, draft: { ...intake.draft, question: null },
    ...(intake.unsupported.length ? { acknowledgedUnsupported: true } : {}) });
  console.log(`${at()}  contract confirmed ${contract.id}`);

  const events = await shop(contract.id);
  const options = events.find((e): e is Extract<ProgressEvent, { type: "options" }> => e.type === "options");
  const skus = options?.options.flatMap((o) => o.lines.map((l) => l.sku)) ?? [];
  console.log("\nM4 acceptance checks");
  check("options include SHOE-WIDE-01 and SHOE-WIDE-02", skus.includes("SHOE-WIDE-01") && skus.includes("SHOE-WIDE-02"));
  check('compare highlights "$12.96 cheaper but 14-day returns"', options?.compare.tradeoff === "$12.96 cheaper but 14-day returns"
    && options.compare.rows.some((r) => r.highlight && r.label === "Returns"));
  check("SHOE-LUX-01 is filtered out with a reason", events.some((e) => e.type === "flagged" && e.sku === "SHOE-LUX-01" && e.reason.length > 0));
  check("every option has a reason and Why? details", !!options && options.options.every((o) => o.reason.length > 0
    && options.details.some((d) => d.rank === o.rank && d.checks.length > 0 && d.dataUsed.length > 0)));
  check("the run ended with done", events.at(-1)?.type === "done");
  if (!options || failures.length) throw new Error(`${failures.length} check(s) failed`);

  const rank = options.options.find((o) => o.lines.some((l) => l.sku === "SHOE-WIDE-01"))!.rank;
  const { cart } = await call("POST", "/api/carts", { contractId: contract.id, rank });
  const { verdict, approval } = await call("POST", "/api/verify", { cartId: cart.id });
  console.log(`\n${at()}  verdict ${verdict.pass ? "PASS" : "BLOCKED"} total ${dollars(verdict.totalCents)}`);
  if (!verdict.pass || !approval) {
    for (const f of verdict.failures) console.log(`     ${f.code}: ${f.detail}`);
    throw new Error("The cart did not pass verification");
  }
  const { purchaseNumber, paymentLinkUrl } = await call("POST", "/api/approve", { cartId: cart.id, approvalNonce: approval.approvalNonce });
  const audit = await call("GET", "/api/audit/verify");
  console.log(`${at()}  approved purchase ${purchaseNumber}; audit chain ${audit.ok ? "ok" : `BROKEN at ${audit.brokenAt}`} (${audit.length} entries)`);
  console.log(`\nSandbox payment link for ${dollars(verdict.totalCents)}:\n${paymentLinkUrl}`);
}

main().catch((e: unknown) => {
  console.error(`\ne2e:shop failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
