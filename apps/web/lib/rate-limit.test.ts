import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

describe("sliding-window intake limit", () => {
  it("allows 20 calls per key, blocks the next, and expires calls at the window boundary", () => {
    let time = 0;
    const limiter = createRateLimiter({ max: 20, windowMs: 3_600_000, now: () => time });
    for (let i = 0; i < 20; i++) expect(limiter.allow("session")).toBe(true);
    expect(limiter.allow("session")).toBe(false);
    expect(limiter.allow("other")).toBe(true);
    time = 3_599_999;
    expect(limiter.allow("session")).toBe(false);
    time++;
    expect(limiter.allow("session")).toBe(true);
  });

  it("expires individual calls rather than resetting the entire window", () => {
    let time = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 100, now: () => time });
    expect(limiter.allow("s")).toBe(true);
    time = 50;
    expect(limiter.allow("s")).toBe(true);
    time = 100;
    expect(limiter.allow("s")).toBe(true);
    expect(limiter.allow("s")).toBe(false);
    time = 150;
    expect(limiter.allow("s")).toBe(true);
  });
});
