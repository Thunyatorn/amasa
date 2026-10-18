// SPEC §4.1. Store-side pricing rules, also used by the web app for Option.estimate.
// Integer cents only.

export interface PricingConfig {
  taxRateBps: number;            // demo value 800 = 8.00%
  freeShippingOverCents: number; // demo value 10000
  flatShippingCents: number;     // demo value 599
}

export const taxCents = (subtotalCents: number, taxRateBps: number) =>
  Math.round(subtotalCents * taxRateBps / 10000);

export const shippingCents = (subtotalCents: number, freeShippingOverCents: number, flatShippingCents: number) =>
  subtotalCents >= freeShippingOverCents ? 0 : flatShippingCents;

export interface PriceBreakdown {
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
}

export function priceLines(
  lines: ReadonlyArray<{ unitCents: number; qty: number }>,
  config: PricingConfig,
): PriceBreakdown {
  for (const l of lines) {
    if (!Number.isInteger(l.unitCents) || !Number.isInteger(l.qty)) {
      throw new Error("priceLines: unitCents and qty must be integers");
    }
  }
  const subtotal = lines.reduce((sum, l) => sum + l.unitCents * l.qty, 0);
  const tax = taxCents(subtotal, config.taxRateBps);
  const shipping = shippingCents(subtotal, config.freeShippingOverCents, config.flatShippingCents);
  return { subtotalCents: subtotal, taxCents: tax, shippingCents: shipping, totalCents: subtotal + tax + shipping };
}
