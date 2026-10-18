import { json, parseBody, route } from "../../../lib/http.ts";
import { OutcomeBody, recordOutcome } from "../../../lib/pipeline/outcome-stage.ts";
import { requireSessionAndCsrf } from "../../../lib/session.ts";

// POST /api/outcomes (SPEC §5): Kept / Returned on the receipt.
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  return json(recordOutcome(await parseBody(request, OutcomeBody)));
});
