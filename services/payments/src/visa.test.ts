import { describe, expect, it } from "vitest";
import { amountToCents, buildLinkParams, extractLink } from "./visa";

// The Visa sandbox charges only the first line item's unit price, once (docs/BUILD_LOG.md "M2 fix"), so the
// link must carry a single line priced at the full signed total.
const req = {
  fields: { purchaseNumber: "ABCDEF0123456789", totalCents: 13932 },
  lines: [{ sku: "SHOE-WIDE-01", title: "Stride Wide Road Running Shoe", qty: 1, unitCents: 12900 }],
  taxCents: 1032,
  shippingCents: 0,
};

describe("Visa payment-link request", () => {
  it("is one line, quantity 1, priced at the full signed total", () => {
    const p = buildLinkParams(req);
    expect(p).toMatchObject({ linkType: "PURCHASE", purchaseNumber: "ABCDEF0123456789", currency: "USD", totalAmount: "139.32" });
    expect(p.lineItems).toHaveLength(1);
    expect(p.lineItems[0]).toMatchObject({ productName: "Amasa order ABCDEF0123456789", quantity: "1", unitPrice: "139.32" });
    expect(p.lineItems[0]!.productDescription).toBe("1 x Stride Wide Road Running Shoe $129.00, Tax $10.32");
  });

  it("multi-item carts with shipping still charge the full total in one line", () => {
    const p = buildLinkParams({ ...req, fields: { ...req.fields, totalCents: 2 * 449 + 72 + 599 },
      lines: [{ sku: "GROC-OATS-01", title: "Rolled Oats 1 kg", qty: 2, unitCents: 449 }], taxCents: 72, shippingCents: 599 });
    expect(p.lineItems[0]).toMatchObject({ quantity: "1", unitPrice: "15.69" });
    expect(p.lineItems[0]!.productDescription).toBe("2 x Rolled Oats 1 kg $4.49, Tax $0.72, Shipping $5.99");
  });

  it("keeps the description to Visa's allowed characters and at most 250 characters", () => {
    const p = buildLinkParams({ ...req, lines: [{ ...req.lines[0]!, title: 'Shoe​\n<b>"x";[y] ' + "x".repeat(300) }] });
    const d = p.lineItems[0]!.productDescription;
    expect(d.length).toBeLessThanOrEqual(250);
    expect(d).toMatch(/^[A-Za-z0-9 !@#$%?&'(),/_+=.-]*$/);
    expect(d.startsWith("1 x Shoe b x y xxx")).toBe(true);
  });
});

describe("Visa response parsing", () => {
  it("converts Visa's amount strings to integer cents", () => {
    expect(amountToCents("129")).toBe(12900);
    expect(amountToCents("1.08")).toBe(108);
    expect(amountToCents("139.3")).toBe(13930);
    expect(amountToCents("139.32")).toBe(13932);
    expect(amountToCents("0.08")).toBe(8);
  });

  it("extracts the link and the charged amount from a real-shaped response", () => {
    const r = extractLink({
      id: "X", status: "ACTIVE",
      purchaseInformation: { purchaseNumber: "X", paymentLink: "https://ebc2test.cybersource.com:443/ebc2/payByLink/pay/abc" },
      orderInformation: { amountDetails: { totalAmount: "129", currency: "USD" }, lineItems: [] },
    });
    expect(r).toEqual({ paymentLinkUrl: "https://ebc2test.cybersource.com:443/ebc2/payByLink/pay/abc", chargedCents: 12900 });
  });

  it("rejects responses without a link, without a USD total, or with an odd amount", () => {
    const base = { purchaseInformation: { paymentLink: "https://x.test/pay" }, orderInformation: { amountDetails: { totalAmount: "1", currency: "USD" } } };
    expect(() => extractLink({ ...base, purchaseInformation: {} })).toThrow();
    expect(() => extractLink({ ...base, orderInformation: { amountDetails: { totalAmount: "1", currency: "EUR" } } })).toThrow();
    expect(() => extractLink({ ...base, orderInformation: { amountDetails: { totalAmount: "1.234", currency: "USD" } } })).toThrow();
    expect(() => extractLink({ ...base, purchaseInformation: { paymentLink: "http://x.test/pay" } })).toThrow();
  });
});
