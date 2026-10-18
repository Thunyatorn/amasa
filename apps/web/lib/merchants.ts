// The merchants Amasa can shop (one mock store in this build, SPEC §4). Contracts may only list
// these, and carts are always placed with the store the options came from.
export const KNOWN_MERCHANTS = ["demo-store"] as const;
export const STORE_MERCHANT = "demo-store";

// demo-store's published pricing rules (SPEC §4.1), used only for Option estimates. The money that
// counts always comes from the store's own quote at checkout. A test keeps these equal to the store.
export const STORE_PRICING = { taxRateBps: 800, freeShippingOverCents: 10_000, flatShippingCents: 599 } as const;
