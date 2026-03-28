"use client";

import { useState } from "react";
import BN from "bn.js";
import { truncateAddress, formatTokenAmount } from "@/lib/format";
import { useVault } from "@/components/providers/VaultProvider";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import type { StrategyData } from "@/hooks/useStrategies";

interface Props {
  strategy: StrategyData;
  onRefresh: () => Promise<void>;
}

export function StrategyCard({ strategy, onRefresh }: Props) {
  const { vault } = useVault();
  const { rebalanceStrategy, reportYield } = useAuthorityActions();
  const { deactivateStrategy, setStrategyWeight } = useAdminActions();
  const [weightInput, setWeightInput] = useState("");
  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const totalDeposited = vault?.totalDeposited.toNumber() || 0;
  const allocationPct =
    totalDeposited > 0
      ? (strategy.allocatedAmount.toNumber() / totalDeposited) * 100
      : 0;

  const targetPct = strategy.targetWeightBps / 100;
  const targetAmount = totalDeposited > 0
    ? Math.floor(totalDeposited * strategy.targetWeightBps / 10000)
    : 0;
  const isAtTarget = strategy.allocatedAmount.toNumber() === targetAmount;

  const unreportedYield = strategy.actualBalance
    .sub(strategy.allocatedAmount)
    .toNumber();

  async function handleAction(action: () => Promise<string | string[]>) {
    setActionLoading(true);
    try {
      const result = await action();
      const sig = Array.isArray(result) ? result[result.length - 1] : result;
      if (sig) showTxSuccess(sig);
      setWeightInput("");
      await onRefresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">#{strategy.strategyId.toString()}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              strategy.isActive
                ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                : "bg-[var(--color-danger)]/20 text-[var(--color-danger)]"
            }`}
          >
            {strategy.isActive ? "Active" : "Inactive"}
          </span>
          {strategy.isActive && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
              Weight: {targetPct}%
            </span>
          )}
        </div>
        {strategy.isActive && (
          <button
            onClick={() => setShowActions(!showActions)}
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            {showActions ? "Hide" : "Actions"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-[var(--color-text-muted)]">Delegate</span>
          <p className="font-mono">{truncateAddress(strategy.delegate.toBase58())}</p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Allocated</span>
          <p>{formatTokenAmount(strategy.allocatedAmount)} USDC ({allocationPct.toFixed(1)}%)</p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Target</span>
          <p>
            {formatTokenAmount(targetAmount)} USDC ({targetPct}%)
            {isAtTarget ? (
              <span className="ml-1 text-[var(--color-success)]">&#10003;</span>
            ) : (
              <span className="ml-1 text-[var(--color-warning)]">&#8800;</span>
            )}
          </p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Actual Balance</span>
          <p>{formatTokenAmount(strategy.actualBalance)} USDC</p>
        </div>
        {unreportedYield > 0 && (
          <div>
            <span className="text-[var(--color-text-muted)]">Unreported Yield</span>
            <p className="text-[var(--color-success)]">
              +{formatTokenAmount(unreportedYield)} USDC
            </p>
          </div>
        )}
      </div>

      {/* Report Yield — always visible when there's unreported yield */}
      {strategy.isActive && unreportedYield > 0 && (
        <div className="mt-3">
          <button
            onClick={() =>
              handleAction(() =>
                reportYield(strategy.strategyId.toNumber(), strategy.tokenAccount)
              )
            }
            disabled={actionLoading}
            className="w-full rounded-lg bg-[var(--color-success)]/20 px-4 py-2 text-sm font-medium text-[var(--color-success)] disabled:opacity-50"
          >
            Report Yield (+{formatTokenAmount(unreportedYield)} USDC)
          </button>
        </div>
      )}

      {showActions && strategy.isActive && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          {/* Set Weight */}
          <div className="flex gap-2">
            <input
              type="number"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              placeholder="Weight % (e.g. 50)"
              min="0"
              max="100"
              step="0.01"
              className="flex-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => {
                const pct = parseFloat(weightInput);
                if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                  const bps = Math.round(pct * 100);
                  handleAction(() =>
                    setStrategyWeight(strategy.strategyId.toNumber(), bps)
                  );
                }
              }}
              disabled={actionLoading || !weightInput}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              Set Weight
            </button>
          </div>

          {/* Rebalance */}
          {!isAtTarget && (
            <button
              onClick={() =>
                handleAction(() =>
                  rebalanceStrategy(
                    strategy.strategyId.toNumber(),
                    strategy.tokenAccount
                  )
                )
              }
              disabled={actionLoading}
              className="w-full rounded-lg bg-[var(--color-accent)]/20 px-4 py-2 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50"
            >
              Rebalance to Target ({formatTokenAmount(targetAmount)} USDC)
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (confirm("Deactivate this strategy permanently?"))
                  handleAction(() =>
                    deactivateStrategy(
                      strategy.strategyId.toNumber(),
                      strategy.tokenAccount
                    )
                  );
              }}
              disabled={actionLoading}
              className="rounded-lg bg-[var(--color-danger)]/20 px-4 py-2 text-sm font-medium text-[var(--color-danger)] disabled:opacity-50"
            >
              Deactivate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
