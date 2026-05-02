/**
 * MVP allow-list — symbol + decimals + role for the 12 tokens to seed.
 * Mint pubkeys are cluster-dependent and live in JSON files written by
 * `mint-mvp-tokens.ts` (devnet) or hardcoded into the mainnet registry
 * (when ready). The seed script reads the appropriate JSON.
 */

export interface MvpToken {
  symbol: string;
  decimals: number;
  role: string;
}

export const MVP_TOKEN_LIST: MvpToken[] = [
  { symbol: "wSOL",    decimals: 9, role: "Native gas; universal base pair" },
  { symbol: "USDC",    decimals: 6, role: "#1 stablecoin quote currency" },
  { symbol: "USDT",    decimals: 6, role: "Second major stablecoin quote currency" },
  { symbol: "JUP",     decimals: 6, role: "Jupiter governance; routes 10k+ pairs" },
  { symbol: "jitoSOL", decimals: 9, role: "Largest LST; collateral across major lending protocols" },
  { symbol: "RAY",     decimals: 6, role: "Raydium AMM token; powers 14k+ pairs" },
  { symbol: "mSOL",    decimals: 9, role: "Marinade LST; oldest + deepest DeFi integration" },
  { symbol: "wETH",    decimals: 8, role: "Wormhole-bridged ETH; deep arb pools" },
  { symbol: "BONK",    decimals: 5, role: "Most-integrated meme token" },
  { symbol: "WIF",     decimals: 6, role: "CEX + DEX dual-listing; constant arb liquidity" },
  { symbol: "PYTH",    decimals: 6, role: "Pyth oracle token" },
  { symbol: "KMNO",    decimals: 6, role: "Kamino governance token" },
];

/** Output of `mint-mvp-tokens.ts`. Symbol → mint pubkey (base58). */
export type MvpMintsFile = Record<string, string>;
