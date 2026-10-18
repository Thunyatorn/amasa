import { verifyAudit } from "@amasa/audit";
import { getDb } from "../../../lib/db/index.ts";
import { json, route } from "../../../lib/http.ts";
import { requireSession } from "../../../lib/session.ts";

// GET /api/audit: the chain check and the latest entries for "Your history" in Settings. Payloads are
// not sent; erased rows are shown as "erased at your request" (SPEC §13).
export const GET = route(async (request: Request) => {
  requireSession(request);
  const db = getDb();
  const rows = db.prepare("SELECT seq, ts, type, erased FROM audit ORDER BY seq DESC LIMIT 50").all() as { seq: number; ts: string; type: string; erased: number }[];
  return json({ check: verifyAudit(db), entries: rows.map((r) => ({ seq: r.seq, ts: r.ts, type: r.type, erased: r.erased === 1 })) });
});
