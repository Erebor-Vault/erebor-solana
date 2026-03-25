"use client";

import { useStrategies } from "@/hooks/useStrategies";
import { StrategyCard } from "./StrategyCard";

export function StrategyList() {
  const { strategies, loading, refresh } = useStrategies();

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
      {strategies.map((s) => (
        <StrategyCard key={s.publicKey.toBase58()} strategy={s} onRefresh={refresh} />
      ))}
    </div>
  );
}
