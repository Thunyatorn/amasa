import { ProfileEntry } from "@amasa/schemas";
import { z } from "zod";
import { appendAudit } from "@amasa/audit";
import { ApiError } from "../http.ts";
import type { Db } from "./index.ts";

export function listProfileEntries(db: Db): ProfileEntry[] {
  const rows = db.prepare("SELECT json FROM profile_entries").all() as { json: string }[];
  return rows.map((row) => ProfileEntry.parse(JSON.parse(row.json)))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function confirmedProfile(db: Db): ProfileEntry[] {
  return listProfileEntries(db).filter((entry) => entry.status === "confirmed");
}

// A user's own edit of an entry's value (SPEC §5). An edited entry is a user edit and is
// confirmed at once (SPEC §12); confirming a suggestion unchanged is confirmProfileEntry.
export const ProfileUpdates = ProfileEntry.pick({ value: true });

export function profileId(id: string): string {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new ApiError(400, "INVALID_ID", "Choose a valid profile entry id.");
  return parsed.data;
}

function getProfileEntry(db: Db, id: string): ProfileEntry {
  const row = db.prepare("SELECT json FROM profile_entries WHERE id = ?").get(profileId(id)) as { json: string } | undefined;
  if (!row) throw new ApiError(404, "PROFILE_NOT_FOUND", "This profile entry could not be found.");
  return ProfileEntry.parse(JSON.parse(row.json));
}

export function insertProfileEntry(db: Db, input: ProfileEntry): string {
  const parsed = ProfileEntry.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_PROFILE", "The profile entry has invalid values.");
  const entry = ProfileEntry.parse({ ...parsed.data, status: parsed.data.source === "user_edit" ? "confirmed" : "suggested" });
  return db.transaction(() => {
    db.prepare("INSERT INTO profile_entries (id, json) VALUES (?, ?)").run(entry.id, JSON.stringify(entry));
    appendAudit(db, "profile_changed", { entryId: entry.id, key: entry.key }, entry.updatedAt);
    return entry.id;
  }).immediate();
}

export function updateProfileEntry(db: Db, id: string, input: z.infer<typeof ProfileUpdates>): ProfileEntry {
  const parsed = ProfileUpdates.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_PROFILE", "Choose a profile field to update with a valid value.");
  return saveEntry(db, id, (previous) => ({ ...previous, ...parsed.data, source: "user_edit", status: "confirmed" }));
}

// "Keep" on a suggestion (SPEC §12): the entry becomes confirmed; its source stays as it was.
export function confirmProfileEntry(db: Db, id: string): ProfileEntry {
  return saveEntry(db, id, (previous) => ({ ...previous, status: "confirmed" }));
}

function saveEntry(db: Db, id: string, change: (previous: ProfileEntry) => ProfileEntry): ProfileEntry {
  return db.transaction(() => {
    const entry = ProfileEntry.parse({ ...change(getProfileEntry(db, id)), updatedAt: new Date().toISOString() });
    db.prepare("UPDATE profile_entries SET json = ? WHERE id = ?").run(JSON.stringify(entry), entry.id);
    appendAudit(db, "profile_changed", { entryId: entry.id, key: entry.key }, entry.updatedAt);
    return entry;
  }).immediate();
}

export function deleteProfileEntry(db: Db, id: string): void {
  db.transaction(() => {
    const entry = getProfileEntry(db, id);
    db.prepare("DELETE FROM profile_entries WHERE id = ?").run(entry.id);
    appendAudit(db, "profile_changed", { entryId: entry.id, key: entry.key }, new Date().toISOString());
  }).immediate();
}
