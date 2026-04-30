"use client";

import { useState } from "react";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import type { StrategyData } from "@/hooks/useStrategies";

interface Props {
  strategy: StrategyData;
  disabled?: boolean;
  onChanged: () => Promise<void>;
}

export function DeactivateStrategyButton({ strategy, disabled, onChanged }: Props) {
  const { deactivateStrategy } = useAdminActions();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Phase-2 deactivation guard: program rejects unless allocated_amount == 0
  // AND the strategy ATA is empty. Surface that here so the UI never lets the
  // call hit the wire when it would revert.
  const allocatedZero = strategy.allocatedAmount.isZero();
  const ataZero = strategy.actualBalance.isZero();
  const drained = allocatedZero && ataZero;

  async function run() {
    setBusy(true);
    try {
      const sig = await deactivateStrategy(
        strategy.strategyId.toNumber(),
        strategy.tokenAccount
      );
      showTxSuccess(sig);
      setConfirming(false);
      await onChanged();
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!strategy.isActive) {
    return (
      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
        <h3 className="text-base font-semibold">Deactivation</h3>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          This strategy is already deactivated. Deactivation is permanent —
          there is no <code>reactivate_strategy</code> instruction.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/[0.06] p-6">
      <h3 className="text-base font-semibold">Danger zone — deactivate</h3>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
        Permanently flips <code>is_active = false</code>, sets weight to 0, and
        revokes the SPL delegate. There is no reactivation path.
      </p>
      {!drained ? (
        <p className="mt-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2 text-xs text-[var(--color-warning)]">
          Drain first. The program rejects the call while{" "}
          <code>allocated_amount</code> or the strategy ATA is non-zero
          (Phase-2 guard, see MISMATCHES.md §2.2). Use the Authority actions
          panel above to deallocate, then come back.
        </p>
      ) : null}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={disabled || !drained}
          className="mt-4 rounded-md bg-[var(--color-danger)]/20 px-4 py-2 text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Deactivate strategy {strategy.strategyId.toString()}
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-md bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Deactivating…" : "Confirm: deactivate permanently"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
