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

/** Format share price (ratio) */
export function formatSharePrice(
  totalDeposited: BN,
  shareSupply: BN,
  decimals: number = 6
): string {
  if (shareSupply.isZero()) return "1.0000";
  const price = totalDeposited.toNumber() / shareSupply.toNumber();
  return price.toFixed(4);
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
