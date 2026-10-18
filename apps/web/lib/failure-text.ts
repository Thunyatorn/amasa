import type { FailureCode } from "@amasa/schemas";

// SPEC §16 screen 6: every FailureCode as one plain sentence. No codes, no blame. Shared by the
// blocked screen and the demotion notice, so it holds no server-only code.
export const FAILURE_TEXT: Record<FailureCode, string> = {
  CONTRACT_HASH_MISMATCH: "This cart doesn't match the contract you confirmed.",
  EMPTY_CART: "The cart is empty.",
  SKU_NOT_IN_QUOTE: "The store couldn't price one of the products, so it may be sold out or no longer sold.",
  MERCHANT_NOT_ALLOWED: "This store isn't one your contract allows.",
  TAP_FAILED: "The store couldn't confirm that this request came from Amasa.",
  QUOTE_STALE: "The store's price is more than 5 minutes old, so it has to be checked again.",
  CURRENCY_MISMATCH: "The store priced this in a currency other than US dollars.",
  OVER_BUDGET: "The total, including tax and shipping, is over your budget.",
  MUST_HAVE_FAILED: "A product doesn't meet one of your requirements.",
  RETURN_WINDOW_SHORT: "The return window is shorter than you asked for.",
  DEADLINE_MISSED: "It won't arrive by your deadline.",
  QUANTITY_MISMATCH: "The quantity doesn't match your contract.",
  FLAGGED_LISTING: "A product was flagged because its page tried to instruct AI shoppers.",
  WEEKLY_CAP_EXCEEDED: "This order would go over your weekly limit.",
};

// The same sentence as a clause for notices: "a check failed: the total, including tax and shipping, is over your budget".
export const failureClause = (code: FailureCode) => {
  const text = FAILURE_TEXT[code].replace(/\.$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
};
