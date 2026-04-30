import { VAULT_REGISTRY } from "@/lib/constants";
import { deriveVaultPda } from "@/lib/pda";
import { VaultDetailContent } from "./_content";

export function generateStaticParams() {
  return VAULT_REGISTRY.map((e) => ({
    address: deriveVaultPda(e.tokenMint, e.vaultId).toBase58(),
  }));
}

// Static export: only registry vaults are pre-rendered. Unknown
// addresses 404 — fine, the registry is the source of truth.
export const dynamicParams = false;

export default function Page() {
  return <VaultDetailContent />;
}
