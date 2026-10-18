import { z } from "zod";
import { Cart, Quote, SignedFields } from "@amasa/schemas";
import type { Db } from "./index";

export interface CartRecord {
  cart: Cart;
  approval: { fields: SignedFields; signature: string; quote: Quote; nonce: string; nonceUsed: boolean } | null;
}

interface Row { json: string; signed_fields: string | null; signature: string | null; approval_nonce: string | null; nonce_used: number; quote_json: string | null }

export function insertCart(db: Db, cart: Cart, now: string): void {
  db.prepare("INSERT INTO carts (id, contract_id, json, nonce_used, created_at) VALUES (?, ?, ?, 0, ?)")
    .run(cart.id, cart.contractId, JSON.stringify(Cart.parse(cart)), now);
}

export function getCart(db: Db, id: string): CartRecord | null {
  const r = db.prepare("SELECT json, signed_fields, signature, approval_nonce, nonce_used, quote_json FROM carts WHERE id = ?")
    .get(id) as Row | undefined;
  if (!r) return null;
  const cart = Cart.parse(JSON.parse(r.json));
  if (!r.signed_fields || !r.signature || !r.approval_nonce || !r.quote_json) return { cart, approval: null };
  return {
    cart,
    approval: {
      fields: SignedFields.parse(JSON.parse(r.signed_fields)),
      signature: z.string().parse(r.signature),
      quote: Quote.parse(JSON.parse(r.quote_json)),
      nonce: r.approval_nonce,
      nonceUsed: r.nonce_used === 1,
    },
  };
}

// A passing verify replaces any earlier approval: new purchase number, new nonce (SPEC §3).
export function setApproval(db: Db, cartId: string, fields: SignedFields, signature: string, quote: Quote, nonce: string): void {
  db.prepare("UPDATE carts SET signed_fields = ?, signature = ?, quote_json = ?, approval_nonce = ?, nonce_used = 0 WHERE id = ?")
    .run(JSON.stringify(fields), signature, JSON.stringify(quote), nonce, cartId);
}

export function clearApproval(db: Db, cartId: string): void {
  db.prepare("UPDATE carts SET signed_fields = NULL, signature = NULL, quote_json = NULL, approval_nonce = NULL, nonce_used = 0 WHERE id = ?")
    .run(cartId);
}

// Single use: succeeds for exactly one caller with the right nonce.
export function consumeNonce(db: Db, cartId: string, nonce: string): boolean {
  return db.prepare("UPDATE carts SET nonce_used = 1 WHERE id = ? AND approval_nonce = ? AND nonce_used = 0")
    .run(cartId, nonce).changes === 1;
}
