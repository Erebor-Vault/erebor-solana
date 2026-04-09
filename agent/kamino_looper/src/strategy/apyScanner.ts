// apyScanner.ts — Pure functions to compute loop APYs across leverages.
//
// Reads on-chain APY data and produces ranked LoopApyResult[] for the
// allocator to choose from. No side effects, no I/O — easy to unit-test.

import { computeLoopNetApy } from "../utils/math.js";

export type Asset = "USDC" | "BTC" | "SOL";

export interface ApyData {
  asset: Asset;
  supplyApy: number; // decimal, e.g. 0.06 = 6%
  borrowApy: number; // decimal
}

export interface LoopApyResult {
  asset: Asset;
  leverage: number;
  netApy: number;
  rawSupplyApy: number;
  rawBorrowApy: number;
}

// Compute net APYs for each (asset, leverage) combination, filtering out
// any that fall below the minimum threshold. Sorted by net APY descending.
export function computeAllLoopApys(
  apyData: ApyData[],
  minNetApyPct: number,
  maxLeverage: number
): LoopApyResult[] {
  const results: LoopApyResult[] = [];
  const minNetApy = minNetApyPct / 100;

  for (const data of apyData) {
    // Try leverages from 1.5x to maxLeverage in 0.5x steps
    for (let lev = 1.5; lev <= maxLeverage; lev += 0.5) {
      const netApy = computeLoopNetApy(data.supplyApy, data.borrowApy, lev);
      if (netApy >= minNetApy) {
        results.push({
          asset: data.asset,
          leverage: lev,
          netApy,
          rawSupplyApy: data.supplyApy,
          rawBorrowApy: data.borrowApy,
        });
      }
    }
  }

  // Sort by net APY descending
  return results.sort((a, b) => b.netApy - a.netApy);
}

// Find the best USDC loop from the ranked results, or null if none qualify.
export function bestUsdcLoop(loops: LoopApyResult[]): LoopApyResult | null {
  return loops.find((l) => l.asset === "USDC") ?? null;
}
