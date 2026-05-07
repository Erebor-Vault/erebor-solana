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
  /** When true, the vault page renders a "Get demo tokens" faucet button.
   *  Requires `demo_faucet.register_mint` to have been called for the
   *  vault's `tokenMint`. Devnet demos only — never set on prod vaults. */
  demoFaucet?: boolean;
  /** When true, this is a "play with admin" demo vault. The frontend offers
   *  a wallet adapter that loads the admin/authority keypair from
   *  `NEXT_PUBLIC_DEMO_ADMIN_KEYPAIR_BS58`, so anyone visiting can sign
   *  admin txs against it. Devnet only — the keypair is public by design. */
  demoVault?: boolean;
}

export const DEMO_FAUCET_PROGRAM_ID = new PublicKey(
  "C86dEAtswZXMNqVPM6uhftE2yfwwv6qCxo3RpUXa777E"
);

// Round-7 test mint (created by setup-multi-vaults.ts on 2026-05-02 after
// closing + redeploying the 3 programs under fresh keypairs). Pre-redeploy
// mints (GhE6BWCz…, HEYo4Z5K…, HgctyjCk…, J1qLR4P2…, BZwn5e9G…, 45AbULTJ…,
// 5BTPntEhZ…) are orphaned — see docs/DEPLOYMENT.md.
const TEST_USDC_MINT = new PublicKey(
  "7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE"
);

const E2E_TEST_MINT = new PublicKey(
  "J11HnbyCkg5XgpGXZaLHR3KpRCMhxaYfWPnd7EeeyXuZ"
);

export const VAULT_REGISTRY: VaultEntry[] = [
  {
    name: "AT trader agent",
    tokenMint: TEST_USDC_MINT,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    vaultId: 0,
  },
  // Demo Vault — slot #2. Uses a dedicated mint whose authority is the
  // demo_faucet PDA (so the faucet can `mintTo` for everyone). Set
  // NEXT_PUBLIC_DEMO_MINT to the value `setup-demo-vault.ts` writes to
  // ./demo-mint.json. If unset the entry is hidden from the registry so a
  // fresh checkout doesn't render a broken vault card.
  ...(process.env.NEXT_PUBLIC_DEMO_MINT
    ? [
        {
          name: "Demo Vault",
          tokenMint: new PublicKey(process.env.NEXT_PUBLIC_DEMO_MINT),
          tokenSymbol: "dUSDC",
          tokenDecimals: 6,
          vaultId: 0,
          demoFaucet: true,
          demoVault: true,
        } satisfies VaultEntry,
      ]
    : []),
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
  {
    name: "E2E Test Vault",
    tokenMint: E2E_TEST_MINT,
    tokenSymbol: "tUSDC",
    tokenDecimals: 6,
    vaultId: 0,
    demoFaucet: true,
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
