import { AutonomyState, type Category } from "@amasa/schemas";
import type { Db } from "./index";

// Read server-side at verify and approve time (I7). Every category starts at level 0 (SPEC §11).
export function getAutonomy(db: Db, category: Category): { level: 0 | 1 | 2; weeklyCapCents: number } {
  const row = db.prepare("SELECT json FROM autonomy WHERE category = ?").get(category) as { json: string } | undefined;
  if (!row) return { level: 0, weeklyCapCents: 0 };
  const s = AutonomyState.parse(JSON.parse(row.json));
  return { level: s.level, weeklyCapCents: s.weeklyCapCents };
}
