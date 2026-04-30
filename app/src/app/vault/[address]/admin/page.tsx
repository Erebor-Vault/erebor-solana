import { VAULT_REGISTRY } from "@/lib/constants";
import { deriveVaultPda } from "@/lib/pda";
import { AdminPageContent } from "./_content";

export function generateStaticParams() {
  return VAULT_REGISTRY.map((e) => ({
    address: deriveVaultPda(e.tokenMint, e.vaultId).toBase58(),
  }));
}

export const dynamicParams = false;

export default function Page() {
  return <AdminPageContent />;
}
