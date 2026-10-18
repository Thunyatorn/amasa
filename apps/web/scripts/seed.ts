import { ProfileEntry } from "@amasa/schemas";
import type { Db } from "../lib/db/index.ts";
import { insertProfileEntry } from "../lib/db/profile.ts";

const entries = [
  { id: "a3a5a000-0000-4000-8000-000000000001", key: "size", value: 10.5, source: "user_edit", status: "confirmed", note: "" },
  { id: "a3a5a000-0000-4000-8000-000000000002", key: "width", value: "wide", source: "user_edit", status: "confirmed", note: "" },
  { id: "a3a5a000-0000-4000-8000-000000000003", key: "brand_like", value: "Stride", source: "kept", status: "suggested", note: "You kept Stride shoes twice" },
];

export function seed(db: Db): void {
  db.transaction(() => {
    for (const input of entries) {
      const entry = ProfileEntry.parse({ ...input, category: "running-shoes", updatedAt: "2026-10-17T00:00:00.000Z" });
      if (!db.prepare("SELECT id FROM profile_entries WHERE id = ?").get(entry.id)) insertProfileEntry(db, entry);
    }
  }).immediate();
}
