import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "FuAJhyS6ZB9RbVEoeUVhezbWQz7g7k71QqVD6TWFYEDo"
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

// Round-7 test mint (created by setup-multi-vaults.ts on 2026-05-02 after
// closing + redeploying the 3 programs under fresh keypairs). Pre-redeploy
// mints (GhE6BWCz…, HEYo4Z5K…, HgctyjCk…, J1qLR4P2…, BZwn5e9G…, 45AbULTJ…,
// 5BTPntEhZ…) are orphaned — see docs/DEPLOYMENT.md.
const TEST_USDC_MINT = new PublicKey(
  "7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE"
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
