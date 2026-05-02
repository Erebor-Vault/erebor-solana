"use client";

import { useMemo, useState } from "react";
import { useStrategies } from "@/hooks/useStrategies";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { useVault } from "@/components/providers/VaultProvider";
import { useRoles } from "@/hooks/useRoles";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { StrategyCard } from "./StrategyCard";

export function StrategyList() {
  const { strategies, loading, refresh } = useStrategies();
  const { vault } = useVault();
  const { isAuthority } = useRoles();
  const { rebalanceAll, loading: rebalanceLoading } = useAuthorityActions();
  const [rebalancing, setRebalancing] = useState(false);

  const activeStrategies = useMemo(
    () => strategies.filter((s) => s.isActive),
    [strategies]
  );

  // Sum of weights across active strategies. The program does NOT cap this
  // (each strategy individually capped at 10 000 bps; aggregate intentionally
  // unenforced — see docs/SOLANA_VAULT_SPEC.md §15 / docs/MISMATCHES.md §2.2). Surface
  // the running total so admins can see the residual reserve buffer or notice
  // an over-allocation before they trigger a rebalance.
  const activeSumBps = useMemo(
    () => activeStrategies.reduce((acc, s) => acc + (s.targetWeightBps ?? 0), 0),
    [activeStrategies]
  );

  const handleRebalanceAll = async () => {
    if (!vault) return;
    setRebalancing(true);
    try {
      const sigs = await rebalanceAll(
        activeStrategies.map((s) => ({
          strategyId: s.strategyId.toNumber(),
          tokenAccount: s.tokenAccount,
          allocatedAmount: s.allocatedAmount,
          targetWeightBps: s.targetWeightBps,
        })),
        vault.totalDeposited.toNumber()
      );
      if (sigs.length > 0) showTxSuccess(sigs[sigs.length - 1]);
      await refresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setRebalancing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl bg-[var(--color-surface-secondary)] h-32"
          />
        ))}
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-8 text-center">
        <p className="text-[var(--color-text-secondary)]">
          No strategies created yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WeightSumBar
        sumBps={activeSumBps}
        canRebalance={isAuthority && activeStrategies.length > 0}
        rebalancing={rebalancing || rebalanceLoading}
        onRebalance={handleRebalanceAll}
      />
      {strategies.map((s) => (
        <StrategyCard key={s.publicKey.toBase58()} strategy={s} onRefresh={refresh} />
      ))}
    </div>
  );
}

function WeightSumBar({
  sumBps,
  canRebalance,
  rebalancing,
  onRebalance,
}: {
  sumBps: number;
  canRebalance: boolean;
  rebalancing: boolean;
  onRebalance: () => void;
}) {
  const pct = Math.min(sumBps / 100, 100);
  const reserveBufferBps = Math.max(10000 - sumBps, 0);
  const overAllocated = sumBps > 10000;

  const barColor = overAllocated
    ? "bg-[var(--color-danger)]"
    : sumBps === 10000
      ? "bg-[var(--color-accent)]"
      : "bg-[var(--color-accent-secondary)]";

  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">Active strategy weight sum</span>
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-sm tabular-nums ${
              overAllocated
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-text-secondary)]"
            }`}
          >
            {(sumBps / 100).toFixed(2)}% of 100%
          </span>
          <button
            type="button"
            onClick={onRebalance}
            disabled={!canRebalance || rebalancing || overAllocated}
            title={
              !canRebalance
                ? "Authority only"
                : overAllocated
                  ? "Over-allocated — lower a weight first"
                  : "Rebalance every active strategy to its target"
            }
            className="inline-flex items-center gap-2 rounded-md border border-[var(--color-accent-secondary)]/30 bg-[var(--color-accent-secondary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-secondary)] transition-colors hover:border-[var(--color-accent-secondary)]/60 hover:bg-[var(--color-accent-secondary)]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {rebalancing ? "Rebalancing…" : "Rebalance"}
            <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
              {(sumBps / 100).toFixed(0)}%
            </span>
          </button>
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuenow={sumBps}
        aria-valuemin={0}
        aria-valuemax={10000}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-hover)]"
      >
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {overAllocated
          ? "Over-allocated. The next rebalance will fail mid-loop on insufficient reserve. Lower at least one weight before rebalancing."
          : reserveBufferBps === 0
            ? "Fully allocated to strategies. The reserve will only hold the float between rebalances."
            : `${(reserveBufferBps / 100).toFixed(2)}% stays in the reserve as a liquidity buffer.`}
      </p>
    </div>
  );
}
