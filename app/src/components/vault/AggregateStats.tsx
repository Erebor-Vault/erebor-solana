"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { deriveVaultPda, deriveShareMintPda, deriveUserAta } from "@/lib/pda";
import { formatTokenAmount } from "@/lib/format";

interface Aggregate {
  totalTvl: BN;
  initializedVaults: number;
  totalStrategies: number;
  /** Sum of the user's estimated underlying value across all vaults. */
  userValue: BN;
  /** Number of vaults where the user holds shares. */
  userVaultCount: number;
  loading: boolean;
}

const ZERO: Aggregate = {
  totalTvl: new BN(0),
  initializedVaults: 0,
  totalStrategies: 0,
  userValue: new BN(0),
  userVaultCount: 0,
  loading: true,
};

export function AggregateStats() {
  const { vaultEntries } = useVault();
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const program = useVaultProgram();
  const [agg, setAgg] = useState<Aggregate>(ZERO);

  useEffect(() => {
    let cancelled = false;
    setAgg((a) => ({ ...a, loading: true }));

    (async () => {
      let totalTvl = new BN(0);
      let initialized = 0;
      let totalStrategies = 0;
      let userValue = new BN(0);
      let userVaultCount = 0;

      for (const entry of vaultEntries) {
        const vaultPda = deriveVaultPda(entry.tokenMint, entry.vaultId);
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vault: any = await (program.account as any).vaultState.fetch(vaultPda);
          initialized += 1;
          totalTvl = totalTvl.add(vault.totalDeposited as BN);
          totalStrategies += (vault.strategyCount as BN).toNumber();

          if (publicKey) {
            const shareMint = deriveShareMintPda(vaultPda);
            const userShareAta = deriveUserAta(shareMint, publicKey);
            try {
              const sharesInfo = await connection.getTokenAccountBalance(userShareAta);
              const shares = new BN(sharesInfo.value.amount);
              if (!shares.isZero()) {
                const supplyInfo = await connection.getTokenSupply(shareMint);
                const supply = new BN(supplyInfo.value.amount);
                if (!supply.isZero()) {
                  // user_value = shares * total_deposited / supply
                  const value = shares.mul(vault.totalDeposited as BN).div(supply);
                  userValue = userValue.add(value);
                  userVaultCount += 1;
                }
              }
            } catch {
              // user has no shares ATA for this vault
            }
          }
        } catch {
          // vault not initialized — skip
        }
      }

      if (!cancelled) {
        setAgg({
          totalTvl,
          initializedVaults: initialized,
          totalStrategies,
          userValue,
          userVaultCount,
          loading: false,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [program, connection, vaultEntries, publicKey]);

  const items: { label: string; value: string; suffix: string | null }[] = [
    {
      label: "Total Value Locked",
      value: agg.loading
        ? "…"
        : formatTokenAmount(agg.totalTvl, vaultEntries[0]?.tokenDecimals ?? 6),
      suffix: vaultEntries[0]?.tokenSymbol ?? null,
    },
    {
      label: "Vaults",
      value: agg.loading
        ? "…"
        : `${agg.initializedVaults} / ${vaultEntries.length}`,
      suffix: "initialized",
    },
    {
      label: "Strategies",
      value: agg.loading ? "…" : agg.totalStrategies.toString(),
      suffix: "total",
    },
    {
      label: "Your Position",
      value: agg.loading
        ? "…"
        : connected
          ? formatTokenAmount(agg.userValue, vaultEntries[0]?.tokenDecimals ?? 6)
          : "—",
      suffix: connected
        ? `${vaultEntries[0]?.tokenSymbol ?? ""} · ${agg.userVaultCount} ${
            agg.userVaultCount === 1 ? "vault" : "vaults"
          }`
        : "connect wallet",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-5"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {stat.label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {stat.value}
            {stat.suffix ? (
              <span className="ml-1 text-sm font-normal text-[var(--color-text-muted)]">
                {stat.suffix}
              </span>
            ) : null}
          </p>
        </div>
      ))}
    </div>
  );
}
