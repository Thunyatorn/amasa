import { z } from "zod";
import { ContractDraft, Rule } from "@amasa/schemas";
import { getDb } from "../../../../lib/db/index.ts";
import { getDraftRecord } from "../../../../lib/db/drafts.ts";
import { ApiError, json, route } from "../../../../lib/http.ts";
import { requireSession } from "../../../../lib/session.ts";

const Params = z.strictObject({ id: z.string().uuid() });
const Result = z.strictObject({ draft: ContractDraft, unsupported: z.array(Rule).max(8) });

export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  requireSession(request);
  const params = Params.safeParse(await context.params);
  if (!params.success) throw new ApiError(400, "INVALID_ID", "Choose a valid draft id.");
  const record = getDraftRecord(getDb(), params.data.id);
  if (!record) throw new ApiError(404, "DRAFT_NOT_FOUND", "This draft could not be found.");
  return json(Result.parse(record));
});
