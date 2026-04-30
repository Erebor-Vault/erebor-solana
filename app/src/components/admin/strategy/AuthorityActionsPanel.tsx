"use client";

import { useState } from "react";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { useVault } from "@/components/providers/VaultProvider";
import { formatTokenAmount, parseTokenInput } from "@/lib/format";
import type { StrategyData } from "@/hooks/useStrategies";

interface Props {
  strategy: StrategyData;
  disabled?: boolean;
  onChanged: () => Promise<void>;
}

/**
 * Authority-only manual moves: allocate from reserve, deallocate back to
 * reserve, single-strategy weight-driven rebalance, report yield. Spec §7.6
 * wants `rebalance(strategy_id, delta: i64)`; today the on-chain instruction
 * is permissionless and weight-driven, so the UI mirrors that for now.
 */
export function AuthorityActionsPanel({ strategy, disabled, onChanged }: Props) {
  const { activeEntry, vault } = useVault();
  const { allocate, deallocate, rebalanceStrategy, reportYield } = useAuthorityActions();
  const [allocAmt, setAllocAmt] = useState("");
  const [deallocAmt, setDeallocAmt] = useState("");
  const [busy, setBusy] = useState<null | "alloc" | "dealloc" | "rebal" | "yield">(null);

  const decimals = activeEntry.tokenDecimals;
  const symbol = activeEntry.tokenSymbol;
  const totalDeposited = vault?.totalDeposited.toNumber() || 0;
  const targetAmt = totalDeposited > 0
    ? Math.floor((totalDeposited * strategy.targetWeightBps) / 10_000)
    : 0;
  const isAtTarget = strategy.allocatedAmount.toNumber() === targetAmt;
  const unreported = strategy.actualBalance.sub(strategy.allocatedAmount);
  const hasUnreported = unreported.gtn(0);

  async function run<T>(label: typeof busy, fn: () => Promise<T>) {
    setBusy(label);
    try {
      const result = await fn();
      const sig = Array.isArray(result) ? result[result.length - 1] : (result as unknown as string);
      if (sig) showTxSuccess(sig);
      await onChanged();
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(null);
    }
  }

  const allocBn = parseTokenInput(allocAmt, decimals);
  const deallocBn = parseTokenInput(deallocAmt, decimals);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-4">
        <h3 className="text-base font-semibold">Authority actions</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Manual fund moves between the reserve and this strategy plus
          weight-driven rebalance and yield reporting.
        </p>
      </header>

      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Allocate (reserve → strategy)
            </label>
            <input
              type="text"
              value={allocAmt}
              onChange={(e) => setAllocAmt(e.target.value)}
              placeholder={`amount in ${symbol}`}
              disabled={disabled || busy !== null}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={() => allocBn && run("alloc", () => allocate(strategy.strategyId.toNumber(), strategy.tokenAccount, allocBn))}
            disabled={disabled || busy !== null || !allocBn}
            className="rounded-md bg-[var(--color-accent)]/20 px-4 py-2 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50 hover:bg-[var(--color-accent)]/30"
          >
            {busy === "alloc" ? "Allocating…" : "Allocate"}
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Deallocate (strategy → reserve)
            </label>
            <input
              type="text"
              value={deallocAmt}
              onChange={(e) => setDeallocAmt(e.target.value)}
              placeholder={`amount in ${symbol}`}
              disabled={disabled || busy !== null}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={() => deallocBn && run("dealloc", () => deallocate(strategy.strategyId.toNumber(), strategy.tokenAccount, deallocBn))}
            disabled={disabled || busy !== null || !deallocBn}
            className="rounded-md bg-[var(--color-accent-secondary)]/20 px-4 py-2 text-sm font-medium text-[var(--color-accent-secondary)] disabled:opacity-50 hover:bg-[var(--color-accent-secondary)]/30"
          >
            {busy === "dealloc" ? "Deallocating…" : "Deallocate"}
          </button>
        </div>

        <button
          type="button"
          onClick={() => run("rebal", () => rebalanceStrategy(strategy.strategyId.toNumber(), strategy.tokenAccount))}
          disabled={disabled || busy !== null || isAtTarget}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:border-[var(--color-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "rebal"
            ? "Rebalancing…"
            : isAtTarget
              ? `At target (${formatTokenAmount(targetAmt, decimals)} ${symbol})`
              : `Rebalance to target (${formatTokenAmount(targetAmt, decimals)} ${symbol})`}
        </button>

        <button
          type="button"
          onClick={() => run("yield", () => reportYield(strategy.strategyId.toNumber(), strategy.tokenAccount))}
          disabled={disabled || busy !== null || !hasUnreported}
          className="rounded-md bg-[var(--color-success)]/20 px-4 py-2 text-sm font-medium text-[var(--color-success)] disabled:opacity-50 hover:bg-[var(--color-success)]/30"
        >
          {busy === "yield"
            ? "Reporting…"
            : hasUnreported
              ? `Report yield (+${formatTokenAmount(unreported, decimals)} ${symbol})`
              : "No unreported yield"}
        </button>
      </div>
    </section>
  );
}
