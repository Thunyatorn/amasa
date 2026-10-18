import { json, parseBody, route } from "../../../lib/http";
import { ConfirmBody, confirmContract } from "../../../lib/pipeline/contract-stage";
import { requireSessionAndCsrf } from "../../../lib/session";

// POST /api/contracts (SPEC §5).
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { draft } = await parseBody(request, ConfirmBody);
  return json(confirmContract(draft));
});
