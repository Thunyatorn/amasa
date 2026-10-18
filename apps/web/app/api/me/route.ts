import { eraseAuditPayloads } from "@amasa/audit";
import { getDb } from "../../../lib/db/index.ts";
import { json, route } from "../../../lib/http.ts";
import { requireSessionAndCsrf } from "../../../lib/session.ts";

const TABLES = ["contract_drafts", "contracts", "carts", "options", "purchases", "profile_entries", "autonomy", "notices"] as const;

// DELETE /api/me (SPEC §5, §13): removes every personal record. Audit rows keep their hashes so the
// chain still verifies; their payloads are blanked and marked erased.
export const DELETE = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const db = getDb();
  db.transaction(() => {
    for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
    eraseAuditPayloads(db);
  }).immediate();
  return json({ ok: true });
});
