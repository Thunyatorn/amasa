import type { Contract, Option, ProgressEvent } from "@amasa/schemas";
import { getDb } from "../db";
import { getAutonomy } from "../db/autonomy";
import { ApiError } from "../http";
import { approveCart } from "./approve-stage";
import { createCart } from "./cart-stage";
import { verifyCart } from "./verify-stage";

// SPEC §5 "Level 2 flow" and §11. Runs after a shopping run has saved its options. The level is read
// from the database here (I7), never from the client. Level 1: build and verify the cart for rank 1
// so one tap approves it. Level 2: also approve it: the weekly cap the verifier checked is checked
// again inside approve, and the payments service re-checks the budget (I3). No model is involved
// (I1): the planner only proposed the options; everything below is the same code path a tap on
// "Approve" uses.
export async function prepareStage(contract: Contract, options: readonly Option[], emit: (event: ProgressEvent) => void, signal: AbortSignal): Promise<void> {
  if (!options.length || signal.aborted) return;
  const { level } = getAutonomy(getDb(), contract.category);
  if (level === 0) return;
  const rank = options[0]!.rank;
  try {
    const cart = createCart(contract.id, rank);
    const { verdict, approval } = await verifyCart(cart.id);
    if (level === 1 || !verdict.pass || !approval || signal.aborted) {
      emit({ type: "prepared", level, rank, cartId: cart.id, verdict, approval, payment: null });
      return;
    }
    const payment = await approveCart(cart.id, approval.approvalNonce);
    emit({ type: "step", text: "Ready to pay: one tap" });
    emit({ type: "prepared", level: 2, rank, cartId: cart.id, verdict, approval: null, payment });
  } catch (error) {
    // The options stay on screen; the shopper can still choose one by hand.
    const message = error instanceof ApiError ? error.message : "The top option couldn't be prepared.";
    emit({ type: "step", text: `Couldn't prepare the top option: ${message}`.slice(0, 140) });
  }
}
