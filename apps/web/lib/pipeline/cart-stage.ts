import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Cart } from "@amasa/schemas";
import { appendAudit } from "@amasa/audit";
import { getDb } from "../db";
import { insertCart } from "../db/carts";
import { getContract } from "../db/contracts";
import { getOptions } from "../db/options";
import { ApiError } from "../http";
import { STORE_MERCHANT } from "../merchants";

export const CartBody = z.strictObject({ contractId: z.string().uuid(), rank: z.number().int().min(1).max(3) });

// POST /api/carts: builds the cart from the chosen option. A cart never carries prices (SPEC §2.8).
export function createCart(contractId: string, rank: number): Cart {
  const db = getDb();
  const stored = getContract(db, contractId);
  if (!stored) throw new ApiError(404, "CONTRACT_NOT_FOUND", "That contract was not found.");
  const option = getOptions(db, contractId)?.options.find((o) => o.rank === rank);
  if (!option) throw new ApiError(404, "OPTION_NOT_FOUND", "That option is no longer available. Run the search again.");

  const cart = Cart.parse({
    id: randomUUID(),
    contractId,
    contractHash: stored.contractHash,
    merchant: STORE_MERCHANT,
    lines: option.lines.map((l) => ({ sku: l.sku, qty: l.qty })),
  });
  const now = new Date().toISOString();
  db.transaction(() => {
    insertCart(db, cart, now);
    appendAudit(db, "cart_created", { cartId: cart.id, contractId, rank }, now);
  }).immediate();
  return cart;
}
