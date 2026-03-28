import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "4VgPkuQSgqvaBaE7X5ZyUFeMPRMj7yAa8cgsi22ZTvik"
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
  return (
    process.env.NEXT_PUBLIC_RPC_URL || CLUSTERS[getCluster()].url
  );
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
    name: "Test Token Vault",
    tokenMint: new PublicKey("6zrRz3TtZqfZuHmpzC5ZCVM99HoZ6wq6ptNN6d5nwTBR"),
    tokenSymbol: "TEST",
    tokenDecimals: 6,
    vaultId: 0,
  },
  // Add more vaults here:
  // {
  //   name: "USDC Vault",
  //   tokenMint: new PublicKey("..."),
  //   tokenSymbol: "USDC",
  //   tokenDecimals: 6,
  // },
];

export function getExplorerUrl(
  address: string,
  type: "address" | "tx" = "address"
): string {
  const cluster = getCluster();
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${type}/${address}${clusterParam}`;
}
