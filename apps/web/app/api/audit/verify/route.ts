import { verifyAudit } from "@amasa/audit";
import { getDb } from "../../../../lib/db";
import { json, route } from "../../../../lib/http";
import { requireSession } from "../../../../lib/session";

// GET /api/audit/verify (SPEC §13): recomputes the chain; brokenAt is the first broken seq.
export const GET = route(async (request: Request) => {
  requireSession(request);
  return json(verifyAudit(getDb()));
});
