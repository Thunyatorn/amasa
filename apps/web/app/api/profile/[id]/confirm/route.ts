import { z } from "zod";
import { ProfileEntry } from "@amasa/schemas";
import { getDb } from "../../../../../lib/db/index.ts";
import { confirmProfileEntry } from "../../../../../lib/db/profile.ts";
import { ApiError, json, route } from "../../../../../lib/http.ts";
import { requireSessionAndCsrf } from "../../../../../lib/session.ts";

const Params = z.strictObject({ id: z.string().uuid() });
const Result = z.strictObject({ entry: ProfileEntry });

export const POST = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  requireSessionAndCsrf(request);
  const params = Params.safeParse(await context.params);
  if (!params.success) throw new ApiError(400, "INVALID_ID", "Choose a valid profile entry id.");
  return json(Result.parse({ entry: confirmProfileEntry(getDb(), params.data.id) }));
});
