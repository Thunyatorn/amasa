import { z } from "zod";
import { getDb } from "../../../../lib/db/index.ts";
import { getAutonomyState } from "../../../../lib/db/autonomy.ts";
import { getCart } from "../../../../lib/db/carts.ts";
import { getContract } from "../../../../lib/db/contracts.ts";
import { listProfileEntries } from "../../../../lib/db/profile.ts";
import { getPurchase } from "../../../../lib/db/purchases.ts";
import { ApiError, json, route } from "../../../../lib/http.ts";
import { requireSession } from "../../../../lib/session.ts";

const Params = z.strictObject({ purchaseNumber: z.string().regex(/^[A-Z0-9]{16}$/) });
const DAY_MS = 86_400_000;

// GET /api/purchases/[purchaseNumber]: everything the receipt (screen 7) shows. Prices come from the
// store quote this purchase was signed against; the audit head is the chain head at purchase time.
export const GET = route(async (request: Request, context: { params: Promise<{ purchaseNumber: string }> }) => {
  requireSession(request);
  const params = Params.safeParse(await context.params);
  if (!params.success) throw new ApiError(400, "INVALID_ID", "Choose a valid order.");
  const db = getDb();
  const record = getPurchase(db, params.data.purchaseNumber);
  if (!record) throw new ApiError(404, "PURCHASE_NOT_FOUND", "That order was not found.");
  const { purchase } = record;
  const cart = getCart(db, purchase.cartId);
  const quote = cart?.approval?.fields.purchaseNumber === purchase.purchaseNumber ? cart.approval.quote : null;
  const stored = getContract(db, purchase.contractId);
  const linked = ["link_created", "kept", "returned"].includes(purchase.status);
  const returnDays = quote ? Math.min(...quote.lines.map((line) => line.returnDays)) : null;
  return json({
    purchase,
    lines: quote ? quote.lines.map(({ sku, title, qty, unitCents, lineCents, returnDays: days }) => ({ sku, title, qty, unitCents, lineCents, returnDays: days }))
      : (cart?.cart.lines ?? []).map(({ sku, qty }) => ({ sku, title: sku, qty, unitCents: null, lineCents: null, returnDays: null })),
    totals: quote ? { subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, shippingCents: quote.shippingCents, totalCents: quote.totalCents } : null,
    contract: stored?.contract ?? null,
    returnBy: linked && returnDays !== null ? new Date(Date.parse(purchase.createdAt) + returnDays * DAY_MS).toISOString().slice(0, 10) : null,
    auditHead: record.auditHead,
    outcomeReason: record.outcomeReason,
    failureCodes: record.failureCodes,
    suggestions: listProfileEntries(db).filter((e) => e.status === "suggested" && (e.category === purchase.category || e.category === "all")),
    autonomy: getAutonomyState(db, purchase.category),
  });
});
