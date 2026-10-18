import { z } from "zod";
import type { PaymentRequest } from "@amasa/schemas";
import { env } from "./env";

// Calls the isolated payments service (SPEC §10.3). Both reply shapes are zod-parsed.
const Ok = z.strictObject({ purchaseNumber: z.string(), paymentLinkUrl: z.string().url().startsWith("https://") });
const Err = z.object({ code: z.string().max(64), message: z.string().max(200) });

export type PayOutcome = { ok: true; paymentLinkUrl: string } | { ok: false; code: string; message: string };

export async function requestPaymentLink(req: PaymentRequest): Promise<PayOutcome> {
  let res: Response;
  try {
    res = await fetch(`${env().PAYMENTS_URL}/pay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    return { ok: false, code: "PAYMENTS_UNAVAILABLE", message: "The payments service is not responding." };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const ok = Ok.safeParse(body);
    if (ok.success && ok.data.purchaseNumber === req.fields.purchaseNumber) return { ok: true, paymentLinkUrl: ok.data.paymentLinkUrl };
    return { ok: false, code: "PAYMENTS_BAD_RESPONSE", message: "The payments service sent a response we could not read." };
  }
  const err = Err.safeParse(body);
  return err.success ? { ok: false, ...err.data } : { ok: false, code: "PAYMENTS_ERROR", message: "The payment could not be prepared." };
}
