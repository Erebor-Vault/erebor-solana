"use client";

import { useMemo } from "react";
import { useStrategies } from "@/hooks/useStrategies";
import { StrategyCard } from "./StrategyCard";

export function StrategyList() {
  const { strategies, loading, refresh } = useStrategies();

  // Sum of weights across active strategies. The program does NOT cap this
  // (each strategy individually capped at 10 000 bps; aggregate intentionally
  // unenforced — see docs/SOLANA_VAULT_SPEC.md §15 / docs/MISMATCHES.md §2.2). Surface
  // the running total so admins can see the residual reserve buffer or notice
  // an over-allocation before they trigger a rebalance.
  const activeSumBps = useMemo(
    () =>
      strategies
        .filter((s) => s.isActive)
        .reduce((acc, s) => acc + (s.targetWeightBps ?? 0), 0),
    [strategies]
  );

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
      <WeightSumBar sumBps={activeSumBps} />
      {strategies.map((s) => (
        <StrategyCard key={s.publicKey.toBase58()} strategy={s} onRefresh={refresh} />
      ))}
    </div>
  );
}

function WeightSumBar({ sumBps }: { sumBps: number }) {
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
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">Active strategy weight sum</span>
        <span
          className={`text-sm font-mono ${
            overAllocated ? "text-[var(--color-danger)]" : "text-[var(--color-text-secondary)]"
          }`}
        >
          {(sumBps / 100).toFixed(2)}% of 100%
        </span>
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
