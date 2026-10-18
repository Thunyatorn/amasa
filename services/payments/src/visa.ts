import { randomInt } from "node:crypto";
import { z } from "zod";
import type { VisaAcceptanceAgentToolkit } from "@visaacceptance/agent-toolkit/ai-sdk";

type ToolkitModule = typeof import("@visaacceptance/agent-toolkit/ai-sdk");

// This module is the only Visa caller. It is called by the payments service, never by a model (I1).

// The fields of PaymentRequest (SPEC §2.9) that the Visa call needs. PaymentRequest satisfies
// this shape structurally once the shared schema exists (M1/M2).
export interface LinkRequest {
  fields: { purchaseNumber: string; totalCents: number };
  lines: ReadonlyArray<{ sku: string; title: string; qty: number; unitCents: number }>;
  taxCents: number;
  shippingCents: number;
}

// The toolkit (0.0.96) talks to apitest.cybersource.com only when the environment is exactly
// "SANDBOX"; any other value targets production. Refuse to run if the env says otherwise.
function assertSandbox(): void {
  const env = process.env.VISA_ACCEPTANCE_ENVIRONMENT;
  if (env !== undefined && env !== "SANDBOX") {
    throw new Error('VISA_ACCEPTANCE_ENVIRONMENT must be "SANDBOX" in this build.');
  }
}

let tools: ReturnType<VisaAcceptanceAgentToolkit["getTools"]> | undefined;

// Loaded lazily: importing the toolkit (0.0.96) builds a default instance from env vars at load
// time, and that throws "MerchantID is mandatory" when credentials are absent. Deferring the
// require keeps the server and tests importable without credentials, and runs the sandbox
// check before any toolkit code. It must be require (CJS build): the .mjs build fails to load
// cybersource-rest-client under ESM.
function getTools() {
  if (tools) return tools;
  assertSandbox();
  const { VisaAcceptanceAgentToolkit: Toolkit } =
    require("@visaacceptance/agent-toolkit/ai-sdk") as ToolkitModule;
  const toolkit = new Toolkit(
    process.env.VISA_ACCEPTANCE_MERCHANT_ID,
    process.env.VISA_ACCEPTANCE_API_KEY_ID,
    process.env.VISA_ACCEPTANCE_SECRET_KEY,
    "SANDBOX",
    { actions: { paymentLinks: { create: true, read: true } } },
  );
  tools = toolkit.getTools();
  return tools;
}

const dollars = (c: number) => (c / 100).toFixed(2);

// Visa requires an alphanumeric purchase number under 20 characters; SignedFields uses 16 (§2.9).
const PURCHASE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function newPurchaseNumber(): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += PURCHASE_ALPHABET[randomInt(PURCHASE_ALPHABET.length)];
  return out;
}

// Visa Pay by Link (sandbox, toolkit 0.0.96) charges only the FIRST line item's unit price, once:
// it ignores totalAmount, quantities and every other line (measured 2026-10-17, see docs/BUILD_LOG.md "M2 fix").
// So the link carries exactly one line, quantity 1, priced at the full signed total. The itemized
// cart stays in our signed fields, audit log and receipt; the description lists it for the shopper.
const MAX_DESCRIPTION = 250;
// Visa rejects a productDescription with any character outside letters, numbers, spaces and
// !@#$%?&'(),/_+=.- (sandbox 400 VALIDATION_ERRORS, 2026-10-18). Store titles are untrusted, so
// everything else becomes a space.
const visaSafe = (s: string) => s.replace(/[^A-Za-z0-9 !@#$%?&'(),\/_+=.-]/g, " ").replace(/ {2,}/g, " ").trim();

export function buildLinkParams(req: LinkRequest) {
  const total = dollars(req.fields.totalCents);
  const parts = [
    ...req.lines.map((l) => `${l.qty} x ${l.title} $${dollars(l.unitCents)}`),
    ...(req.taxCents ? [`Tax $${dollars(req.taxCents)}`] : []),
    ...(req.shippingCents ? [`Shipping $${dollars(req.shippingCents)}`] : []),
  ];
  return {
    linkType: "PURCHASE",
    purchaseNumber: req.fields.purchaseNumber,
    currency: "USD",
    totalAmount: total,
    lineItems: [{
      productName: `Amasa order ${req.fields.purchaseNumber}`,
      productSKU: "AMASA-ORDER",
      productDescription: visaSafe(parts.join(", ")).slice(0, MAX_DESCRIPTION),
      quantity: "1",
      unitPrice: total,
    }],
  };
}

// SPEC §10.4. Returns the parsed Visa response; throws on the toolkit's error string.
export async function createLink(req: LinkRequest): Promise<unknown> {
  const createPaymentLink = getTools().create_payment_link;
  if (!createPaymentLink?.execute) throw new Error("create_payment_link tool is not available");
  const raw: unknown = await createPaymentLink.execute(
    buildLinkParams(req),
    { toolCallId: req.fields.purchaseNumber, messages: [] },
  );
  const result: unknown = JSON.parse(raw as string);
  if (typeof result === "string") throw new Error(result);
  return result;
}

// SPEC §20 item 1 (answered in M0): the link URL is purchaseInformation.paymentLink.
// Visa echoes the amount it will charge in orderInformation.amountDetails.totalAmount, without
// trailing zeros ("129", "1.08"). Not strict: the response has many other fields.
const LinkResponse = z.object({
  purchaseInformation: z.object({ paymentLink: z.string().url().startsWith("https://") }),
  orderInformation: z.object({
    amountDetails: z.object({ totalAmount: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.literal("USD") }),
  }),
});

// "129" -> 12900, "1.08" -> 108, "139.3" -> 13930. Integer math only.
export function amountToCents(amount: string): number {
  const [whole, frac = ""] = amount.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function extractLink(result: unknown): { paymentLinkUrl: string; chargedCents: number } {
  const parsed = LinkResponse.safeParse(result);
  if (!parsed.success) throw new Error("Visa response is missing the payment link or the USD total");
  return {
    paymentLinkUrl: parsed.data.purchaseInformation.paymentLink,
    chargedCents: amountToCents(parsed.data.orderInformation.amountDetails.totalAmount),
  };
}
