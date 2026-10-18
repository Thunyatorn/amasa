import { json, parseBody, route } from "../../../lib/http";
import { CartBody, createCart } from "../../../lib/pipeline/cart-stage";
import { requireSessionAndCsrf } from "../../../lib/session";

// POST /api/carts (SPEC §5).
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { contractId, rank } = await parseBody(request, CartBody);
  return json({ cart: createCart(contractId, rank) });
});
