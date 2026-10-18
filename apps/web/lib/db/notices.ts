import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./index";

// SPEC §16 "Change notices": every autonomy or profile change, automatic or by the user, leaves a
// code-written notice that every screen shows until it is dismissed.
export const Notice = z.strictObject({
  id: z.string().uuid(),
  kind: z.enum(["autonomy", "profile"]),
  text: z.string().min(1).max(300),
  createdAt: z.string(),
});
export type Notice = z.infer<typeof Notice>;

export function insertNotice(db: Db, kind: Notice["kind"], text: string, now: string): Notice {
  const notice = Notice.parse({ id: randomUUID(), kind, text, createdAt: now });
  db.prepare("INSERT INTO notices (id, json, created_at, seen) VALUES (?, ?, ?, 0)").run(notice.id, JSON.stringify(notice), now);
  return notice;
}

export function unseenNotices(db: Db): Notice[] {
  const rows = db.prepare("SELECT json FROM notices WHERE seen = 0 ORDER BY created_at, rowid").all() as { json: string }[];
  return rows.map((row) => Notice.parse(JSON.parse(row.json)));
}

// true when the notice existed and was still unseen.
export function markNoticeSeen(db: Db, id: string): boolean {
  return db.prepare("UPDATE notices SET seen = 1 WHERE id = ? AND seen = 0").run(id).changes === 1;
}
