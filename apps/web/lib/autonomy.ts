import type { AutonomyState, Category } from "@amasa/schemas";
import { vu as money } from "./vu.ts";

// SPEC §11 "earned autonomy". Pure rules: every function takes the current state and returns the
// next one plus a code-written notice (null when nothing the user can see changed). The thresholds
// are design choices, not research results, so they live in this one object.
export const AUTONOMY = {
  offerAfterGood: 5,
  defaultWeeklyCapCents: 100_000,
  minWeeklyCapCents: 100,
  maxWeeklyCapCents: 500_000,
} as const;

export type Level = AutonomyState["level"];
export const LEVEL_NAMES: Record<Level, string> = { 0: "Suggest", 1: "Propose", 2: "Prepare" };
export const LEVEL_DESCRIPTIONS: Record<Level, string> = {
  0: "Amasa shows up to 3 options and a comparison. You pick one, then approve it.",
  1: "Amasa picks the best option and checks it for you. One tap approves it.",
  2: "Amasa picks, checks and prepares the payment link within your weekly limit. You still pay on Visa's page.",
};
export const CATEGORY_NAMES: Record<Category, string> = { actors: "Actors", musicians: "Musicians", athletes: "Athletes" };

export type ReturnReason = "not_as_described" | "changed_mind" | "other";
export type Change = { state: AutonomyState; notice: string | null; reason: string };

const levelText = (level: Level) => `level ${level} (${LEVEL_NAMES[level]})`;

export function defaultState(category: Category, now: string): AutonomyState {
  return { category, level: 0, offeredLevel: null, consecutiveGood: 0, weeklyCapCents: 0, updatedAt: now };
}

// A kept order counts toward an offer. The level itself never rises without the user (SPEC §11).
export function onKept(state: AutonomyState, now: string): Change {
  const consecutiveGood = state.consecutiveGood + 1;
  const offer = consecutiveGood >= AUTONOMY.offerAfterGood && state.level < 2 && state.offeredLevel === null
    ? ((state.level + 1) as 1 | 2) : state.offeredLevel;
  const next = { ...state, consecutiveGood, offeredLevel: offer, updatedAt: now };
  const notice = offer !== state.offeredLevel && offer !== null
    ? `You've kept ${consecutiveGood} ${CATEGORY_NAMES[state.category].toLowerCase()} orders in a row. You can let Amasa do more: ${levelText(offer)}, in Settings.`
    : null;
  return { state: next, notice, reason: "kept" };
}

function demote(state: AutonomyState, now: string, why: string, reason: string): Change {
  const level = Math.max(0, state.level - 1) as Level;
  const next = { ...state, level, offeredLevel: null, consecutiveGood: 0, updatedAt: now };
  const name = CATEGORY_NAMES[state.category];
  let notice: string | null = null;
  if (level !== state.level) notice = `${name} lowered from ${levelText(state.level)} to ${levelText(level)} because ${why}.`;
  else if (state.offeredLevel !== null) notice = `The offer to raise ${name.toLowerCase()} to ${levelText(state.offeredLevel)} was withdrawn because ${why}.`;
  return { state: next, notice, reason };
}

export function onReturned(state: AutonomyState, returnReason: ReturnReason, now: string): Change {
  if (returnReason === "not_as_described") return demote(state, now, "you returned an order as not as described", "returned_not_as_described");
  const withdrawn = state.offeredLevel !== null;
  const next = { ...state, consecutiveGood: 0, offeredLevel: null, updatedAt: now };
  const notice = withdrawn
    ? `The offer to raise ${CATEGORY_NAMES[state.category].toLowerCase()} to ${levelText(state.offeredLevel!)} was withdrawn because you returned an order.`
    : null;
  return { state: next, notice, reason: "returned" };
}

// `why` is the plain sentence for the first failed check, e.g. "the total is over your budget".
export function onBlocked(state: AutonomyState, why: string, now: string): Change {
  return demote(state, now, `a check failed: ${why}`, "verifier_block");
}

export type SetLevelResult = { ok: true; change: Change } | { ok: false; code: string; message: string };

// The user's choice in Settings. Raising is allowed only to the offered level; lowering (or keeping
// the current level, which declines an offer) is always allowed and clears the offer. Any choice
// restarts the count, so the next offer needs another run of kept orders.
export function setLevel(state: AutonomyState, level: Level, weeklyCapCents: number | undefined, now: string): SetLevelResult {
  const name = CATEGORY_NAMES[state.category];
  if (level > state.level) {
    if (state.offeredLevel !== level) {
      return { ok: false, code: "LEVEL_NOT_OFFERED", message: `${name} can only be raised to a level Amasa has offered.` };
    }
    let cap = state.weeklyCapCents;
    if (level === 2) {
      cap = weeklyCapCents ?? AUTONOMY.defaultWeeklyCapCents;
      if (!Number.isInteger(cap) || cap < AUTONOMY.minWeeklyCapCents || cap > AUTONOMY.maxWeeklyCapCents) {
        return { ok: false, code: "INVALID_WEEKLY_CAP", message: `Choose a weekly limit from ${money(AUTONOMY.minWeeklyCapCents)} to ${money(AUTONOMY.maxWeeklyCapCents)}.` };
      }
    }
    const next = { ...state, level, offeredLevel: null, consecutiveGood: 0, weeklyCapCents: cap, updatedAt: now };
    const limit = level === 2 ? ` with a weekly limit of ${money(cap)}` : "";
    return { ok: true, change: { state: next, notice: `You raised ${name.toLowerCase()} to ${levelText(level)}${limit}.`, reason: "user_raised" } };
  }
  const next = { ...state, level, offeredLevel: null, consecutiveGood: 0, updatedAt: now };
  if (level < state.level) {
    const after = level === 0 ? "Every purchase now asks you to pick and approve." : "Amasa now prepares one option for you to approve.";
    return { ok: true, change: { state: next, notice: `You lowered ${name.toLowerCase()} to ${levelText(level)}. ${after}`, reason: "user_lowered" } };
  }
  const notice = state.offeredLevel !== null ? `You kept ${name.toLowerCase()} at ${levelText(level)}.` : null;
  return { ok: true, change: { state: next, notice, reason: "user_declined_offer" } };
}
