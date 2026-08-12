import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits } from "./rateLimit.js";

const BUDGET = { limit: 3, windowMs: 60_000 };

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit inside one window", () => {
    const results = [0, 1, 2].map((i) => rateLimit("u1", BUDGET, 1_000 + i));
    expect(results.every((r) => r.allowed)).toBe(true);
  });

  it("blocks the attempt past the limit", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", BUDGET, 1_000);
    expect(rateLimit("u1", BUDGET, 1_000).allowed).toBe(false);
  });

  it("counts down the remaining budget", () => {
    expect(rateLimit("u1", BUDGET, 1_000).remaining).toBe(2);
    expect(rateLimit("u1", BUDGET, 1_000).remaining).toBe(1);
    expect(rateLimit("u1", BUDGET, 1_000).remaining).toBe(0);
  });

  // The whole point of a per-user key: one account exhausting its budget must
  // not answer 429 to everybody else.
  it("keys windows separately", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", BUDGET, 1_000);
    expect(rateLimit("u1", BUDGET, 1_000).allowed).toBe(false);
    expect(rateLimit("u2", BUDGET, 1_000).allowed).toBe(true);
  });

  it("opens a fresh window once the old one expires", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", BUDGET, 1_000);
    expect(rateLimit("u1", BUDGET, 60_000).allowed).toBe(false);
    expect(rateLimit("u1", BUDGET, 61_001).allowed).toBe(true);
  });

  it("reports how long to wait, rounded up", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", BUDGET, 1_000);
    // 59.5 s left on the window
    expect(rateLimit("u1", BUDGET, 1_500).retryAfterSeconds).toBe(60);
  });

  it("never reports a zero wait, which would invite an instant retry", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", BUDGET, 1_000);
    // 1 ms left: rounds to 1 s, not 0
    expect(rateLimit("u1", BUDGET, 60_999).retryAfterSeconds).toBe(1);
  });

  // A blocked caller that keeps retrying must not push its own reset outward.
  it("does not extend the window when it rejects", () => {
    for (let i = 0; i < 3; i++) rateLimit("u1", BUDGET, 1_000);
    for (let t = 2_000; t < 60_000; t += 10_000) rateLimit("u1", BUDGET, t);
    expect(rateLimit("u1", BUDGET, 61_001).allowed).toBe(true);
  });
});
