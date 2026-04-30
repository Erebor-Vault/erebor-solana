// Tests for the pure math helpers used by the apyScanner and allocator.

import { describe, it, expect } from "vitest";
import {
  bpsToDecimal,
  decimalToBps,
  computeLoopNetApy,
  computeHealthFactor,
  microUsdToDollars,
  dollarsToMicroUsd,
} from "../src/utils/math.js";

describe("bpsToDecimal", () => {
  // 600 bps should equal 6% (0.06).
  it("converts 600 bps to 0.06", () => {
    expect(bpsToDecimal(600)).toBe(0.06);
  });

  // 0 bps must convert to 0 — edge case to catch divide-by-zero bugs.
  it("converts 0 bps to 0", () => {
    expect(bpsToDecimal(0)).toBe(0);
  });

  // 10000 bps = 100% = 1.0 — the max sensible value.
  it("converts 10000 bps to 1.0", () => {
    expect(bpsToDecimal(10000)).toBe(1.0);
  });
});

describe("decimalToBps", () => {
  // Inverse of bpsToDecimal.
  it("converts 0.06 to 600", () => {
    expect(decimalToBps(0.06)).toBe(600);
  });

  // Floors fractional bps so we never round up unintentionally.
  it("floors fractional bps", () => {
    expect(decimalToBps(0.0601)).toBe(601);
  });
});

describe("computeLoopNetApy", () => {
  // 1x leverage = single-side lend, no borrow cost. Net APY = supply APY.
  it("returns supply APY at 1x leverage", () => {
    expect(computeLoopNetApy(0.06, 0.04, 1.0)).toBeCloseTo(0.06);
  });

  // 2x leverage with 6% supply, 4% borrow:
  //   netApy = 0.06 * 2 - 0.04 * 1 = 0.12 - 0.04 = 0.08 = 8%
  it("computes 2x loop correctly", () => {
    expect(computeLoopNetApy(0.06, 0.04, 2.0)).toBeCloseTo(0.08);
  });

  // 3x leverage:
  //   netApy = 0.06 * 3 - 0.04 * 2 = 0.18 - 0.08 = 0.10 = 10%
  it("computes 3x loop correctly", () => {
    expect(computeLoopNetApy(0.06, 0.04, 3.0)).toBeCloseTo(0.10);
  });

  // If borrow APY > supply APY, leveraging up loses money.
  // 2x with 4% supply, 6% borrow:
  //   netApy = 0.04 * 2 - 0.06 * 1 = 0.08 - 0.06 = 0.02 (still positive but lower)
  it("returns lower APY when borrow > supply", () => {
    expect(computeLoopNetApy(0.04, 0.06, 2.0)).toBeCloseTo(0.02);
  });

  // 5x leverage with negative spread becomes negative — agent should reject.
  it("can return negative APY", () => {
    const result = computeLoopNetApy(0.04, 0.06, 5.0);
    expect(result).toBeLessThan(0);
  });
});

describe("computeHealthFactor", () => {
  // No debt → infinite HF (cannot be liquidated).
  it("returns Infinity when debt is zero", () => {
    expect(computeHealthFactor(1000, 0)).toBe(Infinity);
  });

  // 200 collateral, 100 debt → HF = 2.0
  it("returns 2.0 for 2x collateralization", () => {
    expect(computeHealthFactor(200, 100)).toBe(2.0);
  });

  // 100 collateral, 100 debt → HF = 1.0 (at liquidation threshold)
  it("returns 1.0 when collateral equals debt", () => {
    expect(computeHealthFactor(100, 100)).toBe(1.0);
  });
});

describe("microUsdToDollars / dollarsToMicroUsd", () => {
  // Round-trip: 60_000_000_000 micro-USD = 60_000 USD = 60_000_000_000 micro-USD
  it("round-trips correctly", () => {
    const original = 60_000;
    const micro = dollarsToMicroUsd(original);
    expect(micro).toBe(60_000_000_000);
    expect(microUsdToDollars(micro)).toBe(original);
  });
});
