import { PublicKey } from "@solana/web3.js";

export interface TokenInfo {
  symbol: string;
  decimals?: number;
}

/** Built-in mainnet mints for common tokens. The devnet mocks created by
 *  `scripts/mint-mvp-tokens.ts` won't be at these addresses, so they're
 *  surfaced via the env-driven map below. */
const BUILTIN: Record<string, TokenInfo> = {
  So11111111111111111111111111111111111111112: { symbol: "wSOL", decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", decimals: 6 },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "jitoSOL", decimals: 9 },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", decimals: 6 },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", decimals: 9 },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "wETH", decimals: 8 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", decimals: 5 },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "WIF", decimals: 6 },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: "PYTH", decimals: 6 },
  KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS: { symbol: "KMNO", decimals: 6 },
};

let envCache: Record<string, TokenInfo> | null = null;

function loadEnvMap(): Record<string, TokenInfo> {
  if (envCache) return envCache;
  const raw = process.env.NEXT_PUBLIC_TOKEN_SYMBOLS;
  if (!raw) {
    envCache = {};
    return envCache;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, TokenInfo> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        // Accept either `{mint: "SYMBOL"}` or `{mint: {symbol, decimals}}`.
        if (typeof v === "string") {
          out[k] = { symbol: v };
        } else if (
          v &&
          typeof v === "object" &&
          "symbol" in v &&
          typeof (v as { symbol: unknown }).symbol === "string"
        ) {
          out[k] = v as TokenInfo;
        }
      }
      envCache = out;
    } else {
      envCache = {};
    }
  } catch {
    console.warn("NEXT_PUBLIC_TOKEN_SYMBOLS is not valid JSON — ignoring");
    envCache = {};
  }
  return envCache;
}

function asKey(mint: PublicKey | string): string {
  return typeof mint === "string" ? mint : mint.toBase58();
}

/** Best-effort symbol lookup. Env map (devnet mocks) takes precedence over
 *  the built-in mainnet map. Returns `null` when unknown. */
export function lookupTokenSymbol(mint: PublicKey | string): string | null {
  const key = asKey(mint);
  const env = loadEnvMap();
  return env[key]?.symbol ?? BUILTIN[key]?.symbol ?? null;
}

/** Full token info (symbol + optional decimals). Same precedence rules. */
export function lookupTokenInfo(mint: PublicKey | string): TokenInfo | null {
  const key = asKey(mint);
  const env = loadEnvMap();
  return env[key] ?? BUILTIN[key] ?? null;
}
