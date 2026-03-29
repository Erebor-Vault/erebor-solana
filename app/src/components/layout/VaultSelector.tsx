"use client";

import { useVault } from "@/components/providers/VaultProvider";
import { truncateAddress } from "@/lib/format";

export function VaultSelector() {
  const { vaultEntries, activeEntry, selectVault } = useVault();

  // Don't render if only one vault
  if (vaultEntries.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-text-muted)]">Vault:</span>
      <select
        value={`${activeEntry.tokenMint.toBase58()}:${activeEntry.vaultId}`}
        onChange={(e) => {
          const [mint, id] = e.target.value.split(":");
          const entry = vaultEntries.find(
            (v) => v.tokenMint.toBase58() === mint && v.vaultId === Number(id)
          );
          if (entry) selectVault(entry.tokenMint, entry.vaultId);
        }}
        className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] cursor-pointer"
      >
        {vaultEntries.map((entry) => (
          <option key={`${entry.tokenMint.toBase58()}:${entry.vaultId}`} value={`${entry.tokenMint.toBase58()}:${entry.vaultId}`}>
            {entry.name} ({entry.tokenSymbol})
          </option>
        ))}
      </select>
    </div>
  );
}
