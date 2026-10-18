import { z } from "zod";
import { getDb } from "../../../../../lib/db/index.ts";
import { markNoticeSeen } from "../../../../../lib/db/notices.ts";
import { ApiError, json, route } from "../../../../../lib/http.ts";
import { requireSessionAndCsrf } from "../../../../../lib/session.ts";

const Params = z.strictObject({ id: z.string().uuid() });

// POST /api/notices/[id]/seen: dismiss one notice.
export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  requireSessionAndCsrf(request);
  const params = Params.safeParse(await context.params);
  if (!params.success) throw new ApiError(400, "INVALID_ID", "Choose a valid notice.");
  if (!markNoticeSeen(getDb(), params.data.id)) throw new ApiError(404, "NOTICE_NOT_FOUND", "That notice was already dismissed.");
  return json({ ok: true });
});
