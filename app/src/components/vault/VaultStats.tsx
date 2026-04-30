"use client";

import { useVault } from "@/components/providers/VaultProvider";
import { formatTokenAmount, formatSharePrice, formatPercent } from "@/lib/format";

export function VaultStats() {
  const { vault, shareSupply, reserveBalance, activeEntry, loading, error } = useVault();

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] h-24"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-surface-secondary)] p-6 text-center">
        <p className="text-[var(--color-danger)]">{error}</p>
      </div>
    );
  }

  if (!vault) return null;

  const totalDeposited = vault.totalDeposited;
  const reserveRatio =
    totalDeposited.toNumber() > 0
      ? reserveBalance.toNumber() / totalDeposited.toNumber()
      : 0;

  const stats: { label: string; value: string; suffix: string | null }[] = [
    {
      label: "Total Value Locked",
      value: formatTokenAmount(totalDeposited, activeEntry.tokenDecimals),
      suffix: activeEntry.tokenSymbol,
    },
    {
      label: "Share Price",
      value: formatSharePrice(totalDeposited, shareSupply, activeEntry.tokenDecimals),
      suffix: activeEntry.tokenSymbol,
    },
    {
      label: "Reserve Ratio",
      value: formatPercent(reserveRatio),
      suffix: null,
    },
    {
      label: "Strategies",
      value: vault.strategyCount.toString(),
      suffix: "active",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-5"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {stat.label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {stat.value}
            {stat.suffix && (
              <span className="ml-1 text-sm font-normal text-[var(--color-text-muted)]">
                {stat.suffix}
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
