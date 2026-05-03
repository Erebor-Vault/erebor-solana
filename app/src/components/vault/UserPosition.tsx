"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useUserPosition } from "@/hooks/useUserPosition";
import { formatTokenAmount, formatShareAmount } from "@/lib/format";
import { useVault } from "@/components/providers/VaultProvider";

export function UserPosition() {
  const { connected } = useWallet();
  const { shareSupply, activeEntry } = useVault();
  const { shareBalance, estimatedValue, loading } = useUserPosition();

  if (!connected) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-6 text-center">
        <p className="text-[var(--color-text-secondary)]">
          Connect your wallet to see your position
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse rounded-xl bg-[var(--color-surface-secondary)] p-6 h-28" />
    );
  }

  const percentOfVault =
    shareSupply.toNumber() > 0
      ? (shareBalance.toNumber() / shareSupply.toNumber()) * 100
      : 0;

  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-6">
      <h3 className="text-sm font-medium text-[var(--color-text-secondary)] mb-4">
        Your Position
      </h3>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">Shares</p>
          <p className="text-lg font-semibold">
            {formatShareAmount(shareBalance, activeEntry.tokenDecimals)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Estimated Value
          </p>
          <p className="text-lg font-semibold">
            {formatTokenAmount(estimatedValue, activeEntry.tokenDecimals)}{" "}
            <span className="text-xs text-[var(--color-text-muted)]">{activeEntry.tokenSymbol}</span>
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">
            % of Vault
          </p>
          <p className="text-lg font-semibold">{percentOfVault.toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
}
