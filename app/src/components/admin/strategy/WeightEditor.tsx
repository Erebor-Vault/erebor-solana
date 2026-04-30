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

export function WeightEditor({ strategy, disabled, onChanged }: Props) {
  const { setStrategyWeight } = useAdminActions();
  const [bps, setBps] = useState<number>(strategy.targetWeightBps);
  const [busy, setBusy] = useState(false);

  const dirty = bps !== strategy.targetWeightBps;
  const canSubmit = !disabled && !busy && dirty && bps >= 0 && bps <= 10_000;
  const pct = (bps / 100).toFixed(2);

  async function save() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const sig = await setStrategyWeight(strategy.strategyId.toNumber(), bps);
      showTxSuccess(sig);
      await onChanged();
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-4">
        <h3 className="text-base font-semibold">
          Target weight — strategy {strategy.strategyId.toString()}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Per-strategy bps cap is 10 000. The program does <em>not</em>{" "}
          enforce a sum cap across strategies — over-allocating will short the
          reserve at rebalance time.
        </p>
      </header>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          {pct}%
        </span>
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {bps} bps
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={10_000}
        step={25}
        value={bps}
        onChange={(e) => setBps(Number(e.target.value))}
        disabled={disabled || busy}
        className="w-full accent-[var(--color-accent)] disabled:opacity-50"
        aria-label="Target weight in basis points"
      />
      <div className="mt-1 grid grid-cols-5 text-[10px] text-[var(--color-text-muted)]">
        <span className="text-left">0%</span>
        <span className="text-center">25%</span>
        <span className="text-center">50%</span>
        <span className="text-center">75%</span>
        <span className="text-right">100%</span>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSubmit}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setBps(strategy.targetWeightBps)}
            disabled={busy}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Reset
          </button>
        ) : null}
      </div>
    </section>
  );
}
