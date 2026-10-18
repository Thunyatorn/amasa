import { z } from "zod";
import { getDb } from "../../../../lib/db";
import { getContract } from "../../../../lib/db/contracts";
import { ApiError, json, route } from "../../../../lib/http";
import { requireSession } from "../../../../lib/session";

// GET /api/contracts/[id] (SPEC §5).
export const GET = route(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  requireSession(request);
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) throw new ApiError(400, "INVALID_REQUEST", "That contract id is not valid.");
  const stored = getContract(getDb(), id.data);
  if (!stored) throw new ApiError(404, "CONTRACT_NOT_FOUND", "That contract was not found.");
  return json(stored);
});
