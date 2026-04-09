// Tests for the APY scanner — pure logic, no I/O.

import { describe, it, expect } from "vitest";
import {
  computeAllLoopApys,
  bestUsdcLoop,
  type ApyData,
} from "../src/strategy/apyScanner.js";

describe("computeAllLoopApys", () => {
  // Standard case: USDC supply 6%, borrow 4%.
  // 1.5x: 0.06*1.5 - 0.04*0.5 = 0.09 - 0.02 = 0.07 = 7% ✓ (above 1.5%)
  // 2.0x: 0.06*2 - 0.04*1 = 0.08 = 8% ✓
  // 2.5x: 0.06*2.5 - 0.04*1.5 = 0.15 - 0.06 = 0.09 = 9% ✓
  // 3.0x: 0.06*3 - 0.04*2 = 0.18 - 0.08 = 0.10 = 10% ✓
  it("returns multiple leverages above min APY threshold", () => {
    const apyData: ApyData[] = [
      { asset: "USDC", supplyApy: 0.06, borrowApy: 0.04 },
    ];
    const results = computeAllLoopApys(apyData, 1.5, 3.0);
    expect(results.length).toBe(4);
    // Sorted by netApy descending — 3x should be first.
    expect(results[0].leverage).toBe(3.0);
    expect(results[0].netApy).toBeCloseTo(0.10);
  });

  // Filter test: when min APY is too high, only the best leverages survive.
  it("filters out APYs below the minimum threshold", () => {
    const apyData: ApyData[] = [
      { asset: "USDC", supplyApy: 0.06, borrowApy: 0.04 },
    ];
    const results = computeAllLoopApys(apyData, 9.5, 3.0); // require >= 9.5%
    expect(results.length).toBe(1);
    expect(results[0].leverage).toBe(3.0);
  });

  // Edge case: if borrow APY is very high, no leverage qualifies.
  it("returns empty when no loop meets threshold", () => {
    const apyData: ApyData[] = [
      { asset: "USDC", supplyApy: 0.02, borrowApy: 0.10 },
    ];
    const results = computeAllLoopApys(apyData, 1.5, 3.0);
    expect(results.length).toBe(0);
  });

  // Multi-asset: results from multiple assets are interleaved by APY.
  it("interleaves results from multiple assets sorted by net APY", () => {
    const apyData: ApyData[] = [
      { asset: "USDC", supplyApy: 0.05, borrowApy: 0.03 },
      { asset: "BTC", supplyApy: 0.08, borrowApy: 0.06 },
    ];
    const results = computeAllLoopApys(apyData, 1.5, 2.0);
    // BTC 2x: 0.08*2 - 0.06*1 = 0.10 = 10%
    // USDC 2x: 0.05*2 - 0.03*1 = 0.07 = 7%
    expect(results[0].asset).toBe("BTC");
  });
});

describe("bestUsdcLoop", () => {
  // bestUsdcLoop ignores volatile assets — returns null if no USDC entries.
  it("returns null when no USDC loops in results", () => {
    const results = computeAllLoopApys(
      [{ asset: "BTC", supplyApy: 0.08, borrowApy: 0.06 }],
      1.5,
      2.0
    );
    expect(bestUsdcLoop(results)).toBeNull();
  });

  // Returns the highest-APY USDC entry (which is first in the sorted list).
  it("returns the highest USDC entry", () => {
    const results = computeAllLoopApys(
      [{ asset: "USDC", supplyApy: 0.06, borrowApy: 0.04 }],
      1.5,
      3.0
    );
    const best = bestUsdcLoop(results);
    expect(best).not.toBeNull();
    expect(best!.leverage).toBe(3.0); // highest leverage = highest APY here
  });
});
