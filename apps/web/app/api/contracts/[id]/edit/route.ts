import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ContractDraft } from "@amasa/schemas";
import { getDb } from "../../../../../lib/db/index.ts";
import { getContract } from "../../../../../lib/db/contracts.ts";
import { insertDraft } from "../../../../../lib/db/drafts.ts";
import { ApiError, json, route } from "../../../../../lib/http.ts";
import { requireSessionAndCsrf } from "../../../../../lib/session.ts";

const Params = z.strictObject({ id: z.string().uuid() });

// POST /api/contracts/[id]/edit: "Edit the rule" on the blocked screen (SPEC §16 screen 6). Copies a
// confirmed contract into a new draft for screen 2; the original contract is not changed.
export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  requireSessionAndCsrf(request);
  const params = Params.safeParse(await context.params);
  if (!params.success) throw new ApiError(400, "INVALID_ID", "Choose a valid contract.");
  const db = getDb();
  const stored = getContract(db, params.data.id);
  if (!stored) throw new ApiError(404, "CONTRACT_NOT_FOUND", "That contract was not found.");
  const { id: _id, confirmedAt: _confirmed, ...terms } = stored.contract;
  const draftId = randomUUID();
  insertDraft(db, draftId, ContractDraft.parse({ ...terms, question: null }), new Date().toISOString());
  return json({ draftId });
});
