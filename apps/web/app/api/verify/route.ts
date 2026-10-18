import { json, parseBody, route } from "../../../lib/http";
import { VerifyBody, verifyCart } from "../../../lib/pipeline/verify-stage";
import { requireSessionAndCsrf } from "../../../lib/session";

// POST /api/verify (SPEC §5, §9). Returns the verdict and, on pass, a single-use approval nonce.
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { cartId } = await parseBody(request, VerifyBody);
  return json(await verifyCart(cartId));
});
