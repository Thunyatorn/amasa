import { z } from "zod";
import { ProfileEntry } from "@amasa/schemas";
import { getDb } from "../../../../lib/db/index.ts";
import { deleteProfileEntry, profileId, ProfileUpdates, updateProfileEntry } from "../../../../lib/db/profile.ts";
import { ApiError, json, parseBody, route } from "../../../../lib/http.ts";
import { requireSessionAndCsrf } from "../../../../lib/session.ts";

const Params = z.strictObject({ id: z.string().uuid() });
const Result = z.strictObject({ entry: ProfileEntry });
async function idFrom(context: { params: Promise<{ id: string }> }): Promise<string> {
  const parsed = Params.safeParse(await context.params);
  if (!parsed.success) throw new ApiError(400, "INVALID_ID", "Choose a valid profile entry id.");
  return profileId(parsed.data.id);
}

export const PATCH = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  requireSessionAndCsrf(request);
  const id = await idFrom(context);
  const updates = await parseBody(request, ProfileUpdates);
  return json(Result.parse({ entry: updateProfileEntry(getDb(), id, updates) }));
});

export const DELETE = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  requireSessionAndCsrf(request);
  deleteProfileEntry(getDb(), await idFrom(context));
  return json({ ok: true });
});
