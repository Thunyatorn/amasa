import { AutonomyState, Category } from "@amasa/schemas";
import { appendAudit } from "@amasa/audit";
import { defaultState, type Change } from "../autonomy";
import type { Db } from "./index";
import { insertNotice } from "./notices";

// Read server-side at shop, verify and approve time (I7). Every category starts at level 0 (SPEC §11).
export function getAutonomyState(db: Db, category: Category, now = new Date().toISOString()): AutonomyState {
  const row = db.prepare("SELECT json FROM autonomy WHERE category = ?").get(category) as { json: string } | undefined;
  return row ? AutonomyState.parse(JSON.parse(row.json)) : defaultState(category, now);
}

export function getAutonomy(db: Db, category: Category): { level: 0 | 1 | 2; weeklyCapCents: number } {
  const state = getAutonomyState(db, category);
  return { level: state.level, weeklyCapCents: state.weeklyCapCents };
}

export function allAutonomyStates(db: Db): AutonomyState[] {
  return Category.options.map((category) => getAutonomyState(db, category));
}

// Saves a change with its audit row and notice. Callers run this inside their own transaction so the
// change is recorded together with whatever caused it.
export function recordAutonomyChange(db: Db, before: AutonomyState, change: Change, now: string): AutonomyState {
  const state = AutonomyState.parse(change.state);
  db.prepare("INSERT INTO autonomy (category, json) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET json = excluded.json")
    .run(state.category, JSON.stringify(state));
  if (before.level !== state.level || before.offeredLevel !== state.offeredLevel || before.weeklyCapCents !== state.weeklyCapCents) {
    appendAudit(db, "autonomy_changed", { category: state.category, from: before.level, to: state.level,
      offeredLevel: state.offeredLevel, weeklyCapCents: state.weeklyCapCents, reason: change.reason }, now);
  }
  if (change.notice) insertNotice(db, "autonomy", change.notice, now);
  return state;
}
