import { describe, expect, it } from "vitest";
import type { AutonomyState } from "@amasa/schemas";
import { AUTONOMY, defaultState, onBlocked, onKept, onReturned, setLevel } from "./autonomy.ts";

const NOW = "2026-10-18T12:00:00.000Z";
const musicians = (over: Partial<AutonomyState> = {}): AutonomyState => ({ ...defaultState("musicians", NOW), ...over });
const keep = (state: AutonomyState, times: number) => Array.from({ length: times }).reduce<AutonomyState>((s) => onKept(s, NOW).state, state);

describe("earned autonomy (SPEC §11)", () => {
  it("starts every category at level 0 with no offer", () => {
    expect(defaultState("athletes", NOW)).toEqual({ category: "athletes", level: 0, offeredLevel: null, consecutiveGood: 0, weeklyCapCents: 0, updatedAt: NOW });
  });

  it("offers the next level after 5 kept orders and never raises it by itself", () => {
    const four = keep(musicians(), 4);
    expect(four).toMatchObject({ level: 0, offeredLevel: null, consecutiveGood: 4 });
    const fifth = onKept(four, NOW);
    expect(fifth.state).toMatchObject({ level: 0, offeredLevel: 1, consecutiveGood: 5 });
    expect(fifth.notice).toContain("You've kept 5 musicians orders in a row");
    const more = keep(fifth.state, 10);
    expect(more).toMatchObject({ level: 0, offeredLevel: 1 });
    expect(onKept(fifth.state, NOW).notice).toBeNull();
    expect(keep(musicians({ level: 2 }), 10)).toMatchObject({ level: 2, offeredLevel: null });
    expect(AUTONOMY.offerAfterGood).toBe(5);
  });

  it("a verifier block lowers the level by one, clears the offer and the count, and says why", () => {
    const change = onBlocked(musicians({ level: 2, offeredLevel: null, consecutiveGood: 3, weeklyCapCents: 100000 }), "the total is over your budget", NOW);
    expect(change.state).toMatchObject({ level: 1, offeredLevel: null, consecutiveGood: 0, weeklyCapCents: 100000 });
    expect(change.notice).toBe("Musicians lowered from level 2 (Prepare) to level 1 (Propose) because a check failed: the total is over your budget.");
    expect(onBlocked(musicians(), "x", NOW)).toMatchObject({ state: { level: 0 }, notice: null });
    expect(onBlocked(musicians({ offeredLevel: 1, consecutiveGood: 5 }), "x", NOW).notice).toContain("was withdrawn because a check failed: x");
  });

  it("a return resets the count; only 'not as described' lowers the level", () => {
    expect(onReturned(musicians({ level: 1, consecutiveGood: 4 }), "changed_mind", NOW).state).toMatchObject({ level: 1, consecutiveGood: 0 });
    const bad = onReturned(musicians({ level: 1, consecutiveGood: 4 }), "not_as_described", NOW);
    expect(bad.state).toMatchObject({ level: 0, consecutiveGood: 0 });
    expect(bad.notice).toContain("because you returned an order as not as described");
    expect(onReturned(musicians({ offeredLevel: 1, consecutiveGood: 5 }), "changed_mind", NOW)).toMatchObject({ state: { offeredLevel: null }, notice: expect.stringContaining("withdrawn") });
  });

  it("raising is allowed only to the offered level, and level 2 needs a weekly limit", () => {
    expect(setLevel(musicians(), 1, undefined, NOW)).toMatchObject({ ok: false, code: "LEVEL_NOT_OFFERED" });
    expect(setLevel(musicians({ offeredLevel: 1 }), 2, undefined, NOW)).toMatchObject({ ok: false, code: "LEVEL_NOT_OFFERED" });
    const one = setLevel(musicians({ offeredLevel: 1, consecutiveGood: 5 }), 1, undefined, NOW);
    expect(one).toMatchObject({ ok: true, change: { state: { level: 1, offeredLevel: null, consecutiveGood: 0 }, notice: "You raised musicians to level 1 (Propose)." } });
    const two = setLevel(musicians({ level: 1, offeredLevel: 2 }), 2, undefined, NOW);
    expect(two).toMatchObject({ ok: true, change: { state: { level: 2, weeklyCapCents: 100000 }, notice: "You raised musicians to level 2 (Prepare) with a weekly limit of 1,000.00 VU." } });
    expect(setLevel(musicians({ level: 1, offeredLevel: 2 }), 2, 50, NOW)).toMatchObject({ ok: false, code: "INVALID_WEEKLY_CAP" });
    expect(setLevel(musicians({ level: 1, offeredLevel: 2 }), 2, 2500, NOW)).toMatchObject({ ok: true, change: { state: { weeklyCapCents: 2500 } } });
  });

  it("lowering takes effect at once and declining an offer clears it", () => {
    const lower = setLevel(musicians({ level: 2, weeklyCapCents: 15000, offeredLevel: null }), 0, undefined, NOW);
    expect(lower).toMatchObject({ ok: true, change: { state: { level: 0, offeredLevel: null }, notice: expect.stringContaining("Every purchase now asks you to pick and approve.") } });
    const decline = setLevel(musicians({ offeredLevel: 1, consecutiveGood: 5 }), 0, undefined, NOW);
    expect(decline).toMatchObject({ ok: true, change: { state: { level: 0, offeredLevel: null, consecutiveGood: 0 }, notice: "You kept musicians at level 0 (Suggest)." } });
    expect(setLevel(musicians(), 0, undefined, NOW)).toMatchObject({ ok: true, change: { notice: null } });
  });
});
