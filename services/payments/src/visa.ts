import { randomInt } from "node:crypto";
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

// SPEC §10.4. Returns the parsed Visa response; throws on the toolkit's error string.
export async function createLink(req: LinkRequest): Promise<unknown> {
  const createPaymentLink = getTools().create_payment_link;
  if (!createPaymentLink?.execute) throw new Error("create_payment_link tool is not available");

  const lineItems = [
    ...req.lines.map((l) => ({ productName: l.title, productSKU: l.sku,
      quantity: String(l.qty), unitPrice: dollars(l.unitCents) })),
    ...(req.taxCents ? [{ productName: "Tax", quantity: "1", unitPrice: dollars(req.taxCents) }] : []),
    ...(req.shippingCents ? [{ productName: "Shipping", quantity: "1", unitPrice: dollars(req.shippingCents) }] : []),
  ];
  const raw: unknown = await createPaymentLink.execute(
    { linkType: "PURCHASE", purchaseNumber: req.fields.purchaseNumber, currency: "USD",
      totalAmount: dollars(req.fields.totalCents), lineItems },
    { toolCallId: req.fields.purchaseNumber, messages: [] },
  );
  const result: unknown = JSON.parse(raw as string);
  if (typeof result === "string") throw new Error(result);
  return result;
}
