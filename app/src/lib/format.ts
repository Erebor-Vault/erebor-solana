import BN from "bn.js";

/** Convert lamports (raw u64) to human-readable token amount */
export function formatTokenAmount(
  amount: BN | number,
  decimals: number = 6
): string {
  const num = typeof amount === "number" ? amount : amount.toNumber();
  const value = num / Math.pow(10, decimals);
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + "M";
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(2) + "K";
  }
  return value.toFixed(decimals > 2 ? 2 : decimals);
}

/**
 * Underlying-per-share, accounting for the on-chain virtual-shares
 * offset (VIRTUAL_SHARES = 1_000_000). Mirrors the redeem formula:
 *   underlying = shares × (assets + 1) / (supply + VIRTUAL_SHARES)
 * which means shares carry `decimals + 6` effective decimals.
 */
const VIRTUAL_SHARES_OFFSET = 6;

export function formatSharePrice(
  totalDeposited: BN,
  shareSupply: BN,
  decimals: number = 6
): string {
  const VIRTUAL_SHARES = new BN(10).pow(new BN(VIRTUAL_SHARES_OFFSET));
  const supplyAdj = shareSupply.add(VIRTUAL_SHARES);
  if (supplyAdj.isZero()) return "1.0000";
  const num = totalDeposited.add(new BN(1));
  // price = (assets + 1) / (supply + VIRTUAL_SHARES), in underlying-per-share-unit
  // Multiply by VIRTUAL_SHARES to scale back to "underlying per virtual share"
  const scaled =
    num.mul(VIRTUAL_SHARES).toNumber() / supplyAdj.toNumber();
  return scaled.toFixed(4);
}

/** Display a raw share-balance as a token-equivalent number (handles the +6 offset). */
export function formatShareAmount(
  shareBalance: BN | number,
  underlyingDecimals: number = 6
): string {
  return formatTokenAmount(shareBalance, underlyingDecimals + VIRTUAL_SHARES_OFFSET);
}

/** Format percentage */
export function formatPercent(value: number): string {
  return (value * 100).toFixed(2) + "%";
}

/** Truncate a pubkey for display */
export function truncateAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/** Parse user input (e.g., "1.5") to raw lamports */
export function parseTokenInput(
  input: string,
  decimals: number = 6
): BN | null {
  const num = parseFloat(input);
  if (isNaN(num) || num <= 0) return null;
  const lamports = Math.floor(num * Math.pow(10, decimals));
  return new BN(lamports);
}
