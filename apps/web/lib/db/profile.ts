import { ProfileEntry } from "@amasa/schemas";
import { z } from "zod";
import { appendAudit } from "@amasa/audit";
import { ApiError } from "../http.ts";
import type { Db } from "./index.ts";
import { insertNotice } from "./notices.ts";

const CATEGORY_WORDS: Record<ProfileEntry["category"], string> = {
  actors: "actors", musicians: "musicians", athletes: "athletes", all: "all categories",
};
// "musicians genre pop": how an entry is named in notices.
export const describeEntry = (entry: ProfileEntry) => `${CATEGORY_WORDS[entry.category]} ${entry.key.replaceAll("_", " ")} ${entry.value}`;

// A confirmed entry replaces any other confirmed entry with the same category and key, so the
// profile never holds both "genre pop" and "genre rock". Each removal is audited.
function replaceSameKey(db: Db, entry: ProfileEntry, now: string): ProfileEntry[] {
  const others = listProfileEntries(db).filter((other) => other.id !== entry.id && other.status === "confirmed"
    && other.category === entry.category && other.key === entry.key);
  for (const other of others) {
    db.prepare("DELETE FROM profile_entries WHERE id = ?").run(other.id);
    appendAudit(db, "profile_changed", { entryId: other.id, key: other.key, replacedBy: entry.id }, now);
  }
  return others;
}
const replacedText = (replaced: ProfileEntry[]) => replaced.length ? ` It replaces ${replaced.map((r) => String(r.value)).join(", ")}.` : "";

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

// `notice` overrides the default change notice; null records none (the demo seed).
export function insertProfileEntry(db: Db, input: ProfileEntry, notice?: string | null): string {
  const parsed = ProfileEntry.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_PROFILE", "The profile entry has invalid values.");
  const entry = ProfileEntry.parse({ ...parsed.data, status: parsed.data.source === "user_edit" ? "confirmed" : "suggested" });
  return db.transaction(() => {
    const replaced = entry.status === "confirmed" ? replaceSameKey(db, entry, entry.updatedAt) : [];
    db.prepare("INSERT INTO profile_entries (id, json) VALUES (?, ?)").run(entry.id, JSON.stringify(entry));
    appendAudit(db, "profile_changed", { entryId: entry.id, key: entry.key }, entry.updatedAt);
    const text = notice === undefined ? `You added ${describeEntry(entry)} to your profile.${replacedText(replaced)}` : notice;
    if (text) insertNotice(db, "profile", text, entry.updatedAt);
    return entry.id;
  }).immediate();
}

export function updateProfileEntry(db: Db, id: string, input: z.infer<typeof ProfileUpdates>): ProfileEntry {
  const parsed = ProfileUpdates.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "INVALID_PROFILE", "Choose a profile field to update with a valid value.");
  return saveEntry(db, id, (previous) => ({ ...previous, ...parsed.data, source: "user_edit", status: "confirmed" }),
    (entry, replaced) => `You changed your profile: ${describeEntry(entry)}.${replacedText(replaced)}`);
}

// "Keep" on a suggestion (SPEC §12): the entry becomes confirmed; its source stays as it was.
export function confirmProfileEntry(db: Db, id: string): ProfileEntry {
  return saveEntry(db, id, (previous) => ({ ...previous, status: "confirmed" }),
    (entry, replaced) => `You kept ${describeEntry(entry)} in your profile.${replacedText(replaced)}`);
}

function saveEntry(db: Db, id: string, change: (previous: ProfileEntry) => ProfileEntry,
  notice: (entry: ProfileEntry, replaced: ProfileEntry[]) => string): ProfileEntry {
  return db.transaction(() => {
    const entry = ProfileEntry.parse({ ...change(getProfileEntry(db, id)), updatedAt: new Date().toISOString() });
    const replaced = replaceSameKey(db, entry, entry.updatedAt);
    db.prepare("UPDATE profile_entries SET json = ? WHERE id = ?").run(JSON.stringify(entry), entry.id);
    appendAudit(db, "profile_changed", { entryId: entry.id, key: entry.key }, entry.updatedAt);
    insertNotice(db, "profile", notice(entry, replaced), entry.updatedAt);
    return entry;
  }).immediate();
}

export function deleteProfileEntry(db: Db, id: string): void {
  db.transaction(() => {
    const entry = getProfileEntry(db, id);
    const now = new Date().toISOString();
    db.prepare("DELETE FROM profile_entries WHERE id = ?").run(entry.id);
    appendAudit(db, "profile_changed", { entryId: entry.id, key: entry.key }, now);
    insertNotice(db, "profile", entry.status === "suggested"
      ? `You forgot the suggestion ${describeEntry(entry)}.` : `You removed ${describeEntry(entry)} from your profile.`, now);
  }).immediate();
}
