// allocator.ts — Decision engine (MVP).
//
// Single-asset USDC self-loop. Decides whether to open, close, adjust, or
// hold based on:
//   - Current portfolio state (idle balance + cToken balance + obligation)
//   - Best available USDC loop APY
//   - Health-factor warnings
//
// Returns an EvalAction that the leverageManager will execute.

import type { LoopApyResult } from "./apyScanner.js";
import { bestLoop } from "./apyScanner.js";

// Single-asset portfolio shape. All amounts are micro-USDC (6 decimals);
// ctokenBalance is in mock_kamino cToken units (also 6 decimals, same as the
// liquidity mint by mock_kamino's init_reserve config).
export interface PortfolioState {
  idleUsdc: number;        // strategy ATA balance
  ctokenBalance: number;   // strategy cToken ATA balance
  suppliedUsdc: number;    // ctokenBalance × totalLiquidity / totalCollateralSupply
  borrowedUsdc: number;    // obligation.borrowed_liquidity (0 if no obligation)
  healthFactor: number;    // suppliedUsdc / borrowedUsdc (Infinity if no debt)
  totalValueUsdc: number;  // idleUsdc + suppliedUsdc - borrowedUsdc
}

export type EvalAction =
  | { action: "NONE"; reason: string }
  | { action: "OPEN_LOOP"; asset: "USDC"; amount: number; targetLeverage: number; reason: string }
  | { action: "CLOSE_LOOP"; asset: "USDC"; reason: string }
  | { action: "ADJUST_LEVERAGE"; asset: "USDC"; targetLeverage: number; reason: string }
  | { action: "EMERGENCY_DELEVERAGE"; reason: string };

export interface AllocatorConfig {
  hfWarning: number;
  hfComfortable: number;
  targetLeverageMin: number;
  targetLeverageMax: number;
  minIdleToOpen: number; // minimum idle balance to open a loop
}

export function decideAllocation(
  portfolio: PortfolioState,
  loopApys: LoopApyResult[],
  config: AllocatorConfig
): EvalAction {
  // Step 1: Safety first — emergency deleverage if HF is critical.
  if (portfolio.healthFactor < config.hfWarning) {
    return {
      action: "EMERGENCY_DELEVERAGE",
      reason: `HF=${portfolio.healthFactor.toFixed(2)} below warning threshold ${config.hfWarning}`,
    };
  }

  // Step 2: Check if any loop meets the minimum APY threshold.
  const best = bestLoop(loopApys);
  const hasPosition = portfolio.suppliedUsdc > 0 || portfolio.borrowedUsdc > 0;

  if (!best) {
    if (hasPosition) {
      return {
        action: "CLOSE_LOOP",
        asset: "USDC",
        reason: "No USDC loop above minimum APY",
      };
    }
    return { action: "NONE", reason: "No qualifying loops, no position" };
  }

  // Step 3: No position + idle funds → open a loop.
  if (!hasPosition) {
    if (portfolio.idleUsdc >= config.minIdleToOpen) {
      const targetLev = Math.max(
        config.targetLeverageMin,
        Math.min(config.targetLeverageMax, best.leverage)
      );
      return {
        action: "OPEN_LOOP",
        asset: "USDC",
        amount: portfolio.idleUsdc,
        targetLeverage: targetLev,
        reason: `Open USDC loop at ${targetLev}x (net APY ${(best.netApy * 100).toFixed(2)}%)`,
      };
    }
    return {
      action: "NONE",
      reason: `Idle balance ${portfolio.idleUsdc} below minimum ${config.minIdleToOpen}`,
    };
  }

  // Step 4a: Orphaned non-leveraged position cleanup. A position with
  // collateral but zero debt usually means a previous loop partially
  // executed (deposit succeeded, borrow failed) and left the collateral
  // stranded. Close it so the next cycle can open a fresh leveraged loop.
  if (portfolio.suppliedUsdc > 0 && portfolio.borrowedUsdc === 0) {
    return {
      action: "CLOSE_LOOP",
      asset: "USDC",
      reason: `Orphaned position (supplied=${(portfolio.suppliedUsdc / 1e6).toFixed(2)} USDC, no debt) — closing to reset`,
    };
  }

  // Step 4b: Position exists and is leveraged — hold it. MVP doesn't
  // rebalance the existing leverage.
  return {
    action: "NONE",
    reason: `Position open with HF=${portfolio.healthFactor.toFixed(2)}, holding`,
  };
}
