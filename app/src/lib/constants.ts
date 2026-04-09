import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "B7EUo8ipi5xNuTtjbrG6enXymac1bD4b6NijYAEFB45z",
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

export const VAULT_REGISTRY: VaultEntry[] = [
  {
    name: "Lending vault",
    tokenMint: new PublicKey("5HLVEnSQeH1dePDMh6sgcbn4mkEMZX9c3fCzqkf194Lp"),
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 0,
  },

  // {
  //   name: "Conservative",
  //   tokenMint: new PublicKey("45AbULTJqK9dpDNDQMb3fe9ojPwc53gr7uUsqHNwkDUY"),
  //   tokenSymbol: "USDC",
  //   tokenDecimals: 6,
  //   vaultId: 1,
  // },
  // {
  //   name: "Aggressive Vault",
  //   tokenMint: new PublicKey("45AbULTJqK9dpDNDQMb3fe9ojPwc53gr7uUsqHNwkDUY"),
  //   tokenSymbol: "USDC",
  //   tokenDecimals: 6,
  //   vaultId: 2,
  // },
  // {
  //   name: "Stablecoin Yield",
  //   tokenMint: new PublicKey("45AbULTJqK9dpDNDQMb3fe9ojPwc53gr7uUsqHNwkDUY"),
  //   tokenSymbol: "USDC",
  //   tokenDecimals: 6,
  //   vaultId: 3,
  // },
  // {
  //   name: "DeFi Alpha",
  //   tokenMint: new PublicKey("45AbULTJqK9dpDNDQMb3fe9ojPwc53gr7uUsqHNwkDUY"),
  //   tokenSymbol: "USDC",
  //   tokenDecimals: 6,
  //   vaultId: 4,
  // },
];

export function getExplorerUrl(
  address: string,
  type: "address" | "tx" = "address",
): string {
  const cluster = getCluster();
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${type}/${address}${clusterParam}`;
}
