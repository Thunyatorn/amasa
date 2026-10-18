import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProfileEntry } from "@amasa/schemas";
import { getDb } from "../../../lib/db/index.ts";
import { insertProfileEntry, listProfileEntries } from "../../../lib/db/profile.ts";
import { json, parseBody, route } from "../../../lib/http.ts";
import { requireSession, requireSessionAndCsrf } from "../../../lib/session.ts";

const Body = ProfileEntry.pick({ category: true, key: true, value: true });
const EntryResult = z.strictObject({ entry: ProfileEntry });
const ListResult = z.strictObject({ entries: z.array(ProfileEntry) });

export const GET = route(async (request: Request) => {
  requireSession(request);
  return json(ListResult.parse({ entries: listProfileEntries(getDb()) }));
});

export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const body = await parseBody(request, Body);
  const entry = ProfileEntry.parse({ ...body, id: randomUUID(), source: "user_edit", status: "confirmed",
    note: "", updatedAt: new Date().toISOString() });
  insertProfileEntry(getDb(), entry);
  return json(EntryResult.parse({ entry }));
});
