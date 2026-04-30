// apyScanner.ts — Pure functions to compute single-asset loop APYs across leverages.
//
// OLD_Erebor's mock_kamino reserve is single-mint and doesn't expose APY rates
// on-chain (yield comes from admin-driven simulate_yield raising the redemption
// rate). The agent supplies its own expected supply/borrow APYs via config and
// this module ranks the resulting loop economics by leverage step.

import { computeLoopNetApy } from "../utils/math.js";

export interface LoopApyResult {
  leverage: number;
  netApy: number;
  rawSupplyApy: number;
  rawBorrowApy: number;
}

// Compute net APYs for each leverage step from 1.5x to maxLeverage (inclusive),
// keeping only the entries above minNetApyPct. Sorted by net APY descending.
export function computeUsdcLoopApys(
  supplyApy: number,
  borrowApy: number,
  minNetApyPct: number,
  maxLeverage: number,
  step: number = 0.5
): LoopApyResult[] {
  const minNetApy = minNetApyPct / 100;
  const results: LoopApyResult[] = [];

  for (let lev = 1.5; lev <= maxLeverage + 1e-9; lev += step) {
    const netApy = computeLoopNetApy(supplyApy, borrowApy, lev);
    if (netApy >= minNetApy) {
      results.push({
        leverage: Number(lev.toFixed(2)),
        netApy,
        rawSupplyApy: supplyApy,
        rawBorrowApy: borrowApy,
      });
    }
  }

  return results.sort((a, b) => b.netApy - a.netApy);
}

// The best (highest-net-APY) loop, or null when none qualify.
export function bestLoop(loops: LoopApyResult[]): LoopApyResult | null {
  return loops.length > 0 ? loops[0] : null;
}
