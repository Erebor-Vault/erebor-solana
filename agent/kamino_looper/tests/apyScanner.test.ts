// Tests for the APY scanner — pure logic, no I/O. Single-asset (USDC self-loop).

import { describe, it, expect } from "vitest";
import { computeUsdcLoopApys, bestLoop } from "../src/strategy/apyScanner.js";

describe("computeUsdcLoopApys", () => {
  // Standard case: USDC supply 6%, borrow 4%.
  // 1.5x: 0.06*1.5 - 0.04*0.5 = 0.09 - 0.02 = 0.07 = 7% ✓ (above 1.5%)
  // 2.0x: 0.06*2 - 0.04*1 = 0.08 = 8% ✓
  // 2.5x: 0.06*2.5 - 0.04*1.5 = 0.15 - 0.06 = 0.09 = 9% ✓
  // 3.0x: 0.06*3 - 0.04*2 = 0.18 - 0.08 = 0.10 = 10% ✓
  it("returns multiple leverages above min APY threshold", () => {
    const results = computeUsdcLoopApys(0.06, 0.04, 1.5, 3.0);
    expect(results.length).toBe(4);
    // Sorted by netApy descending — 3x should be first.
    expect(results[0].leverage).toBe(3.0);
    expect(results[0].netApy).toBeCloseTo(0.10);
  });

  // Filter test: when min APY is too high, only the best leverages survive.
  it("filters out APYs below the minimum threshold", () => {
    const results = computeUsdcLoopApys(0.06, 0.04, 9.5, 3.0);
    expect(results.length).toBe(1);
    expect(results[0].leverage).toBe(3.0);
  });

  // Edge case: high borrow APY, no leverage qualifies.
  it("returns empty when no loop meets threshold", () => {
    const results = computeUsdcLoopApys(0.02, 0.10, 1.5, 3.0);
    expect(results.length).toBe(0);
  });

  // Custom step size — test that the helper respects it.
  it("respects the leverage step size", () => {
    const results = computeUsdcLoopApys(0.06, 0.04, 0, 3.0, 1.0);
    // Steps: 1.5, 2.5 — only two values from the [1.5, 3.0] range.
    // (Loop iterates while lev <= maxLeverage, so 3.5 would be excluded.)
    expect(results.map((r) => r.leverage).sort()).toEqual([1.5, 2.5]);
  });
});

describe("bestLoop", () => {
  // Empty input → null.
  it("returns null when no loops in results", () => {
    expect(bestLoop([])).toBeNull();
  });

  // Returns the highest-APY entry (which is first in the sorted list).
  it("returns the highest-APY entry", () => {
    const results = computeUsdcLoopApys(0.06, 0.04, 1.5, 3.0);
    const best = bestLoop(results);
    expect(best).not.toBeNull();
    expect(best!.leverage).toBe(3.0); // highest leverage = highest APY here
  });
});
