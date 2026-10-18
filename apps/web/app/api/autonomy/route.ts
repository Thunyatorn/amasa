import { z } from "zod";
import { AutonomyState, Category } from "@amasa/schemas";
import { setLevel } from "../../../lib/autonomy.ts";
import { getDb } from "../../../lib/db/index.ts";
import { allAutonomyStates, getAutonomyState, recordAutonomyChange } from "../../../lib/db/autonomy.ts";
import { ApiError, json, parseBody, route } from "../../../lib/http.ts";
import { requireSession, requireSessionAndCsrf } from "../../../lib/session.ts";

const Body = z.strictObject({
  category: Category,
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  weeklyCapCents: z.number().int().optional(),
});

// GET /api/autonomy (SPEC §5).
export const GET = route(async (request: Request) => {
  requireSession(request);
  return json(z.strictObject({ states: z.array(AutonomyState) }).parse({ states: allAutonomyStates(getDb()) }));
});

// POST /api/autonomy (SPEC §5, §11): raise only to the offered level; lowering is always allowed.
export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { category, level, weeklyCapCents } = await parseBody(request, Body);
  const db = getDb();
  const now = new Date().toISOString();
  const state = db.transaction(() => {
    const before = getAutonomyState(db, category, now);
    const result = setLevel(before, level, weeklyCapCents, now);
    if (!result.ok) throw new ApiError(409, result.code, result.message);
    return recordAutonomyChange(db, before, result.change, now);
  }).immediate();
  return json({ state });
});
