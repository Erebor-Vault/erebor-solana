import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z"
);

export const CLUSTERS = {
  devnet: {
    name: "Devnet",
    url: "https://api.devnet.solana.com",
    programId: PROGRAM_ID,
  },
  "mainnet-beta": {
    name: "Mainnet",
    url: "https://api.mainnet-beta.solana.com",
    programId: PROGRAM_ID,
  },
} as const;

export type ClusterName = keyof typeof CLUSTERS;

export function getCluster(): ClusterName {
  const env = process.env.NEXT_PUBLIC_CLUSTER;
  if (env === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || CLUSTERS[getCluster()].url;
}

export function getTokenMint(): PublicKey {
  const mint = process.env.NEXT_PUBLIC_TOKEN_MINT;
  if (mint) return new PublicKey(mint);
  // Default: first vault in registry
  return VAULT_REGISTRY[0].tokenMint;
}

// -------------------------------------------------------------------
// Vault Registry — add new vaults here
// -------------------------------------------------------------------
export interface VaultEntry {
  name: string;
  tokenMint: PublicKey;
  tokenSymbol: string;
  tokenDecimals: number;
  vaultId: number;
}

// Phase-3 round-5 test mint (post per-strategy-authority refactor).
// Pre-refactor mints (HgctyjCk…, J1qLR4P2…, BZwn5e9G…, 45AbULTJ…) are
// orphaned — see DEPLOYMENT.md.
const TEST_USDC_MINT = new PublicKey(
  "5BTPntEhZXMK4FTjJe3VqJM1qZZr58ANpWfJQThPRb6N"
);

export const VAULT_REGISTRY: VaultEntry[] = [
  {
    name: "AT trader agent",
    tokenMint: TEST_USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 0,
  },
  {
    name: "Conservative",
    tokenMint: TEST_USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 1,
  },
  {
    name: "Aggressive Vault",
    tokenMint: TEST_USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 2,
  },
  {
    name: "Stablecoin Yield",
    tokenMint: TEST_USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 3,
  },
  {
    name: "DeFi Alpha",
    tokenMint: TEST_USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 4,
  },
];

export function getExplorerUrl(
  address: string,
  type: "address" | "tx" = "address"
): string {
  const cluster = getCluster();
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${type}/${address}${clusterParam}`;
}
