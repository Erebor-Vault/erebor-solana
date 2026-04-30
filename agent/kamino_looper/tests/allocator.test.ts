// Tests for the MVP allocator decision engine.
//
// The allocator decides what action to take based on the portfolio state
// and the available loop APYs. These tests cover all four decision branches:
// emergency deleverage, no qualifying loops, opening a new loop, and holding.

import { describe, it, expect } from "vitest";
import { decideAllocation, type PortfolioState } from "../src/strategy/allocator.js";
import {
  computeAllLoopApys,
  type ApyData,
} from "../src/strategy/apyScanner.js";

const baseConfig = {
  hfWarning: 1.3,
  hfComfortable: 1.8,
  targetLeverageMin: 2.0,
  targetLeverageMax: 2.5,
  minIdleToOpen: 1_000_000, // 1 USDC
};

const goodApys: ApyData[] = [{ asset: "USDC", supplyApy: 0.06, borrowApy: 0.04 }];
const badApys: ApyData[] = [{ asset: "USDC", supplyApy: 0.02, borrowApy: 0.10 }];

describe("decideAllocation", () => {
  // EMERGENCY: HF below warning → emergency deleverage regardless of APYs.
  // This is the safety branch and must take priority over all other logic.
  it("emergency deleverages when HF < warning threshold", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 100,
      idleUsdc: 0,
      suppliedUsdc: 50_000_000,
      borrowedUsdc: 25_000_000,
      healthFactor: 1.1, // below 1.3
    };
    const loopApys = computeAllLoopApys(goodApys, 1.5, 3.0);
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("EMERGENCY_DELEVERAGE");
  });

  // NONE: no loops above threshold + no existing position → do nothing.
  it("does nothing when no qualifying loops and no position", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 100,
      idleUsdc: 25_000_000,
      suppliedUsdc: 0,
      borrowedUsdc: 0,
      healthFactor: Infinity,
    };
    const loopApys = computeAllLoopApys(badApys, 1.5, 3.0); // empty
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("NONE");
  });

  // CLOSE_LOOP: existing position but APYs dropped below threshold → close it.
  it("closes loop when APYs drop and position exists", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 100,
      idleUsdc: 0,
      suppliedUsdc: 50_000_000,
      borrowedUsdc: 25_000_000,
      healthFactor: 2.0,
    };
    const loopApys = computeAllLoopApys(badApys, 1.5, 3.0); // empty
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("CLOSE_LOOP");
  });

  // OPEN_LOOP: idle funds, no position, good APYs → open a loop.
  // Target leverage should be clamped to [targetLeverageMin, targetLeverageMax].
  it("opens a loop when idle and no position", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 25,
      idleUsdc: 25_000_000,
      suppliedUsdc: 0,
      borrowedUsdc: 0,
      healthFactor: Infinity,
    };
    const loopApys = computeAllLoopApys(goodApys, 1.5, 3.0);
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("OPEN_LOOP");
    if (result.action === "OPEN_LOOP") {
      expect(result.amount).toBe(25_000_000);
      // Best loop is 3.0x, but clamped to targetLeverageMax of 2.5
      expect(result.targetLeverage).toBe(2.5);
    }
  });

  // NONE: idle balance below the minimum to open a loop → wait for more.
  it("does nothing when idle balance below minimum", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 0.5,
      idleUsdc: 500_000, // 0.5 USDC, below 1 USDC minimum
      suppliedUsdc: 0,
      borrowedUsdc: 0,
      healthFactor: Infinity,
    };
    const loopApys = computeAllLoopApys(goodApys, 1.5, 3.0);
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("NONE");
  });

  // CLOSE_LOOP: orphaned non-leveraged position (supplied > 0, borrowed == 0)
  // → close it so the next cycle can re-open with proper leverage. This handles
  // the recovery case where a previous open_loop partially executed.
  it("closes orphaned non-leveraged position", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 50,
      idleUsdc: 0,
      suppliedUsdc: 50_000_000,
      borrowedUsdc: 0,
      healthFactor: Infinity,
    };
    const loopApys = computeAllLoopApys(goodApys, 1.5, 3.0);
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("CLOSE_LOOP");
    if (result.action === "CLOSE_LOOP") {
      expect(result.reason).toContain("Orphaned");
    }
  });

  // NONE: position exists, HF healthy → MVP just holds (no leverage rebalancing).
  it("holds existing position when HF healthy", () => {
    const portfolio: PortfolioState = {
      totalValueUsd: 100,
      idleUsdc: 0,
      suppliedUsdc: 50_000_000,
      borrowedUsdc: 25_000_000,
      healthFactor: 2.0,
    };
    const loopApys = computeAllLoopApys(goodApys, 1.5, 3.0);
    const result = decideAllocation(portfolio, loopApys, baseConfig);
    expect(result.action).toBe("NONE");
  });
});
