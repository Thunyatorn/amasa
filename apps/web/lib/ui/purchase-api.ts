import { z } from "zod";
import { Cart } from "../../../../packages/schemas/src/cart.ts";
import { Contract, Sku } from "../../../../packages/schemas/src/contract.ts";
import { FailureCode, Verdict } from "../../../../packages/schemas/src/payment.ts";
import { AutonomyState, ProfileEntry } from "../../../../packages/schemas/src/profile.ts";
import { Purchase } from "../../../../packages/schemas/src/purchase.ts";

// Browser-side shapes of the M5 APIs (SPEC §5). Every response is validated before it is shown.
export { AutonomyState, FailureCode, ProfileEntry, Verdict };
export const CartResult = z.strictObject({ cart: Cart });
export const Approval = z.strictObject({ approvalNonce: z.string().min(1).max(100), expiresAt: z.number().int() });
export const VerifyResult = z.strictObject({ verdict: Verdict, approval: Approval.nullable() });
export const ApproveResult = z.strictObject({ purchaseNumber: z.string().regex(/^[A-Z0-9]{16}$/), paymentLinkUrl: z.string().url() });
export const DraftIdResult = z.strictObject({ draftId: z.string().uuid() });
export const ReceiptResult = z.strictObject({
  purchase: Purchase,
  lines: z.array(z.strictObject({ sku: Sku, title: z.string().max(80), qty: z.number().int(), unitCents: z.number().int().nullable(),
    lineCents: z.number().int().nullable(), returnDays: z.number().int().nullable() })),
  totals: z.strictObject({ subtotalCents: z.number().int(), taxCents: z.number().int(), shippingCents: z.number().int(), totalCents: z.number().int() }).nullable(),
  contract: Contract.nullable(),
  returnBy: z.string().nullable(),
  auditHead: z.string().nullable(),
  outcomeReason: z.string().nullable(),
  failureCodes: z.array(FailureCode),
  suggestions: z.array(ProfileEntry),
  autonomy: AutonomyState,
});
export type Receipt = z.infer<typeof ReceiptResult>;
export const OutcomeResult = z.strictObject({ purchase: Purchase, suggestions: z.array(ProfileEntry), autonomy: AutonomyState });
export const AutonomyResult = z.strictObject({ states: z.array(AutonomyState) });
export const AutonomyStateResult = z.strictObject({ state: AutonomyState });
export const ProfileResult = z.strictObject({ entries: z.array(ProfileEntry) });
export const EntryResult = z.strictObject({ entry: ProfileEntry });
export const OkResult = z.strictObject({ ok: z.literal(true) });
export const Notice = z.strictObject({ id: z.string().uuid(), kind: z.enum(["autonomy", "profile"]), text: z.string().max(300), createdAt: z.string() });
export const NoticesResult = z.strictObject({ notices: z.array(Notice) });
export const AuditResult = z.strictObject({
  check: z.strictObject({ ok: z.boolean(), length: z.number().int(), brokenAt: z.number().int().nullable() }),
  entries: z.array(z.strictObject({ seq: z.number().int(), ts: z.string(), type: z.string(), erased: z.boolean() })),
});

// Screens that change autonomy or the profile tell the notice banner to refresh.
export const announceChange = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("amasa:changed")); };
