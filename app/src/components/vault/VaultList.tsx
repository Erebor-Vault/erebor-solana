"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { deriveVaultPda, deriveShareMintPda, deriveReserveAta } from "@/lib/pda";
import { formatTokenAmount } from "@/lib/format";
import type { VaultEntry } from "@/lib/constants";

interface VaultSummary {
  entry: VaultEntry;
  vaultPda: PublicKey;
  totalDeposited: BN;
  strategyCount: number;
  reserveBalance: BN;
  exists: boolean;
}

export function VaultList() {
  const { vaultEntries, activeEntry, selectVault } = useVault();
  const { connection } = useConnection();
  const program = useVaultProgram();
  const [summaries, setSummaries] = useState<VaultSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAll() {
      const results: VaultSummary[] = [];

      for (const entry of vaultEntries) {
        const vaultPda = deriveVaultPda(entry.tokenMint, entry.vaultId);
        try {
          const vault = await (program.account as any).vaultState.fetch(vaultPda);
          const reserveAta = deriveReserveAta(vaultPda, entry.tokenMint);
          let reserveBalance = new BN(0);
          try {
            const bal = await connection.getTokenAccountBalance(reserveAta);
            reserveBalance = new BN(bal.value.amount);
          } catch {}

          results.push({
            entry,
            vaultPda,
            totalDeposited: vault.totalDeposited,
            strategyCount: vault.strategyCount.toNumber(),
            reserveBalance,
            exists: true,
          });
        } catch {
          results.push({
            entry,
            vaultPda,
            totalDeposited: new BN(0),
            strategyCount: 0,
            reserveBalance: new BN(0),
            exists: false,
          });
        }
      }

      setSummaries(results);
      setLoading(false);
    }

    fetchAll();
  }, [program, connection, vaultEntries]);

  if (vaultEntries.length <= 1) return null;

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {vaultEntries.map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl bg-[var(--color-surface-secondary)] h-28"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
      {summaries.map((s) => {
        const isActive =
          s.entry.tokenMint.toBase58() === activeEntry.tokenMint.toBase58() &&
          s.entry.vaultId === activeEntry.vaultId;

        return (
          <button
            key={`${s.entry.tokenMint.toBase58()}:${s.entry.vaultId}`}
            onClick={() => selectVault(s.entry.tokenMint, s.entry.vaultId)}
            className={`rounded-xl border p-5 text-left transition-all ${
              isActive
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 ring-1 ring-[var(--color-accent)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:border-[var(--color-accent)]/50"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">{s.entry.name}</h3>
              <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-surface-hover)]">
                {s.entry.tokenSymbol}
              </span>
            </div>

            {s.exists ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)]">TVL</span>
                  <p className="font-medium">
                    {formatTokenAmount(s.totalDeposited)} {s.entry.tokenSymbol}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Strategies</span>
                  <p className="font-medium">{s.strategyCount}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                Not initialized
              </p>
            )}

            {isActive && (
              <div className="mt-2 text-xs text-[var(--color-accent)] font-medium">
                Selected
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
