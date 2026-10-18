import { z } from "zod";
import { getDb } from "../../../lib/db/index.ts";
import { Notice, unseenNotices } from "../../../lib/db/notices.ts";
import { json, route } from "../../../lib/http.ts";
import { requireSession } from "../../../lib/session.ts";

// GET /api/notices: change notices not yet dismissed (SPEC §16).
export const GET = route(async (request: Request) => {
  requireSession(request);
  return json(z.strictObject({ notices: z.array(Notice) }).parse({ notices: unseenNotices(getDb()) }));
});
