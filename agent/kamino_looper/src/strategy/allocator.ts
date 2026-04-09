// allocator.ts — Decision engine (MVP).
//
// MVP scope: USDC-only loops. No delta-neutral hedges, no volatile assets.
// Decides whether to open, close, adjust, or hold based on:
//   - Current position state (open or no position)
//   - Best available USDC loop APY
//   - Health factor warnings
//
// Returns an EvalResult that the leverageManager will execute.

import type { LoopApyResult } from "./apyScanner.js";
import { bestUsdcLoop } from "./apyScanner.js";

export interface PortfolioState {
  totalValueUsd: number;
  idleUsdc: number;       // USDC sitting in strategy token account
  suppliedUsdc: number;   // USDC supplied to Kamino
  borrowedUsdc: number;   // USDC borrowed from Kamino
  healthFactor: number;
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
  // Step 1: Safety first — emergency deleverage if HF is critical
  if (portfolio.healthFactor < config.hfWarning) {
    return {
      action: "EMERGENCY_DELEVERAGE",
      reason: `HF=${portfolio.healthFactor.toFixed(2)} below warning threshold ${config.hfWarning}`,
    };
  }

  // Step 2: Check if any USDC loop meets the minimum APY
  const best = bestUsdcLoop(loopApys);
  const hasPosition = portfolio.suppliedUsdc > 0 || portfolio.borrowedUsdc > 0;

  if (!best) {
    // No qualifying loops — close any open position
    if (hasPosition) {
      return {
        action: "CLOSE_LOOP",
        asset: "USDC",
        reason: "No USDC loop above minimum APY",
      };
    }
    return { action: "NONE", reason: "No qualifying loops, no position" };
  }

  // Step 3: If no position and we have idle funds, open a loop
  if (!hasPosition) {
    if (portfolio.idleUsdc >= config.minIdleToOpen) {
      // Pick a leverage in the target range that matches best.leverage
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

  // Step 4: Position exists — check if it needs adjustment
  // For MVP, we just hold existing positions (no leverage rebalancing)
  return {
    action: "NONE",
    reason: `Position open with HF=${portfolio.healthFactor.toFixed(2)}, holding`,
  };
}
