// math.ts — Pure helper functions for APY, leverage, and basis-point math.
//
// Exported as standalone functions so they can be unit-tested in isolation.

// Convert basis points to a decimal rate. 600 bps → 0.06
export function bpsToDecimal(bps: number): number {
  return bps / 10000;
}

// Convert a decimal rate to basis points. 0.06 → 600
export function decimalToBps(decimal: number): number {
  return Math.floor(decimal * 10000);
}

// Compute the net APY of a leveraged loop:
//   netApy = supplyApy * leverage - borrowApy * (leverage - 1)
//
// Both APYs are in decimal form (0.06 = 6%). Leverage is a multiplier (2.0 = 2x).
// Returns 0 (or negative) if borrow cost exceeds supply yield.
export function computeLoopNetApy(
  supplyApy: number,
  borrowApy: number,
  leverage: number
): number {
  return supplyApy * leverage - borrowApy * (leverage - 1);
}

// Compute the health factor: collateral_value / debt_value.
// Returns Infinity if there's no debt.
export function computeHealthFactor(
  collateralValueUsd: number,
  debtValueUsd: number
): number {
  if (debtValueUsd <= 0) return Infinity;
  return collateralValueUsd / debtValueUsd;
}

// Convert a price in micro-USD (1_000_000 = 1 USD) to USD as a JS number.
export function microUsdToDollars(microUsd: number): number {
  return microUsd / 1_000_000;
}

// Convert a USD value back to micro-USD.
export function dollarsToMicroUsd(usd: number): number {
  return Math.floor(usd * 1_000_000);
}
