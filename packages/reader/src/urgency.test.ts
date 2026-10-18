import { describe, expect, it } from "vitest";
import { stripUrgency, URGENCY_FALLBACK } from "./urgency.ts";

describe("urgency stripping (SPEC §8.3)", () => {
  it.each(["Hurry, it fits.", "Limited time price.", "Act now.", "Only 3 left!", "Selling fast.", "Don't miss it.",
    "Don’t miss it.", "Last chance.", "Today only.", "Buy before it's gone."])("removes %j", (sentence) => {
    expect(stripUrgency(`Wide fit for your size 10.5. ${sentence}`)).toBe("Wide fit for your size 10.5.");
  });
  it("keeps a clean reason unchanged and falls back when nothing is left", () => {
    expect(stripUrgency("Wide, size 10.5, $139.32 within your $140 budget.")).toBe("Wide, size 10.5, $139.32 within your $140 budget.");
    expect(stripUrgency("Hurry! Selling fast.")).toBe(URGENCY_FALLBACK);
    expect(stripUrgency("   ")).toBe(URGENCY_FALLBACK);
  });
});
