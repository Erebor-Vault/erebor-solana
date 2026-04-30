import { VAULT_REGISTRY } from "@/lib/constants";
import { deriveVaultPda } from "@/lib/pda";
import { StrategyAdminContent } from "./_content";

const MAX_STRATEGY_ID = 9; // Pre-renders strategy ids 0..9 per vault for `output: "export"`.

export function generateStaticParams() {
  const out: { address: string; id: string }[] = [];
  for (const e of VAULT_REGISTRY) {
    const address = deriveVaultPda(e.tokenMint, e.vaultId).toBase58();
    for (let id = 0; id <= MAX_STRATEGY_ID; id++) {
      out.push({ address, id: id.toString() });
    }
  }
  return out;
}

export const dynamicParams = false;

export default function Page() {
  return <StrategyAdminContent />;
}
