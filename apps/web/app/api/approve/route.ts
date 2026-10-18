import { json, parseBody, route } from "../../../lib/http";
import { ApproveBody, approveCart } from "../../../lib/pipeline/approve-stage";
import { requireSessionAndCsrf } from "../../../lib/session";

// POST /api/approve (SPEC §5, §10).
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { cartId, approvalNonce } = await parseBody(request, ApproveBody);
  return json(await approveCart(cartId, approvalNonce));
});
