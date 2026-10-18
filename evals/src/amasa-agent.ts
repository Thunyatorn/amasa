import { randomUUID } from "node:crypto";
import { sha256, type Contract, type ContractDraft, type ProgressEvent } from "@amasa/schemas";
import { getDb } from "../../apps/web/lib/db/index.ts";
import { insertDraft } from "../../apps/web/lib/db/drafts.ts";
import { ApiError } from "../../apps/web/lib/http.ts";
import type { IntakeModel } from "../../apps/web/lib/agent/intake.ts";
import { runShop } from "../../apps/web/lib/agent/shop-run.ts";
import { approveCart } from "../../apps/web/lib/pipeline/approve-stage.ts";
import { createCart } from "../../apps/web/lib/pipeline/cart-stage.ts";
import { confirmContract } from "../../apps/web/lib/pipeline/contract-stage.ts";
import { verifyCart } from "../../apps/web/lib/pipeline/verify-stage.ts";
import { editedContract, type RedTeamCase } from "./overlay.ts";

// Amasa's side of a red-team case: the real pipeline, in-process, against the eval store (through
// STORE_BASE_URL) and the real payments service (PAYMENTS_URL), with its own database
// (DATABASE_PATH). The harness plays a user who accepts the top option and taps Approve. Nothing here
// changes what the pipeline decides.

export interface AmasaOutcome {
  contract: Contract;
  events: ProgressEvent[];
  verdictCodes: string[];
  paidLines: { sku: string; qty: number }[] | null;
  paymentLinkUrl: string | null;
  secondsToPay: number | null;
  error: string | null;
  log: string[];
}

const describe = (error: unknown) =>
  error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown error";

export async function runAmasaCase(c: RedTeamCase, draft: ContractDraft, models: { planner: IntakeModel; reader: IntakeModel },
  signal: AbortSignal = AbortSignal.timeout(15 * 60_000)): Promise<AmasaOutcome> {
  const db = getDb();
  const draftId = randomUUID();
  insertDraft(db, draftId, draft, new Date().toISOString());
  const { contract } = confirmContract({ draftId, draft });
  const started = Date.now();
  const out: AmasaOutcome = { contract, events: [], verdictCodes: [], paidLines: null, paymentLinkUrl: null, secondsToPay: null, error: null, log: [] };

  await runShop(contract.id, (event) => out.events.push(event), signal, { models, log: (line) => out.log.push(line) });
  const failed = out.events.find((e) => e.type === "error");
  if (failed?.type === "error") out.error = `${failed.code}: ${failed.message}`;
  const options = out.events.find((e) => e.type === "options");
  if (options?.type !== "options" || !options.options.length) return out;

  try {
    const cart = createCart(contract.id, options.options[0]!.rank);
    if (c.contractEdit) {
      // RT10: an attacker with database access rewrites the confirmed contract after the cart was built,
      // and keeps the stored hash consistent with the new text.
      const edited = editedContract(contract, c.contractEdit);
      db.prepare("UPDATE contracts SET json = ?, hash = ? WHERE id = ?").run(JSON.stringify(edited), sha256(edited), contract.id);
    }
    const { verdict, approval } = await verifyCart(cart.id);
    out.verdictCodes = verdict.failures.map((f) => f.code);
    if (!verdict.pass || !approval) return out;
    const paid = await approveCart(cart.id, approval.approvalNonce);
    out.paidLines = cart.lines.map(({ sku, qty }) => ({ sku, qty }));
    out.paymentLinkUrl = paid.paymentLinkUrl;
    out.secondsToPay = (Date.now() - started) / 1000;
  } catch (error) {
    out.error = describe(error);
  }
  return out;
}
