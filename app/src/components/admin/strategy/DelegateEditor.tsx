"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";
import type { StrategyData } from "@/hooks/useStrategies";

interface Props {
  strategy: StrategyData;
  disabled?: boolean;
  onChanged: () => Promise<void>;
}

export function DelegateEditor({ strategy, disabled, onChanged }: Props) {
  const { updateDelegate } = useAdminActions();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  let parseError: string | null = null;
  let parsed: PublicKey | null = null;
  if (value.trim() !== "") {
    try {
      parsed = new PublicKey(value.trim());
    } catch {
      parseError = "Not a valid base58 pubkey";
    }
  }
  const same =
    parsed !== null && parsed.equals(strategy.delegate);
  const canSubmit = !disabled && !busy && parsed !== null && !same;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !parsed) return;
    setBusy(true);
    try {
      const sig = await updateDelegate(strategy.strategyId.toNumber(), strategy.tokenAccount, parsed);
      showTxSuccess(sig);
      setValue("");
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
          AI agent (delegate) — strategy {strategy.strategyId.toString()}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          The wallet allowed to spend from this strategy&apos;s ATA via the SPL
          delegate. Rotating this re-approves <code>spl-token approve</code>
          {" "}for a new agent without redeploying.
        </p>
      </header>
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-[var(--color-text-muted)]">Current</dt>
        <dd className="font-mono text-xs">
          {truncateAddress(strategy.delegate.toBase58(), 6)}
        </dd>
      </dl>
      <form onSubmit={onSubmit} className="grid gap-3">
        <div className="grid gap-1">
          <label htmlFor={`delegate-${strategy.strategyId}`} className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            New delegate pubkey
          </label>
          <input
            id={`delegate-${strategy.strategyId}`}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Base58 pubkey…"
            spellCheck={false}
            autoComplete="off"
            disabled={disabled || busy}
            aria-invalid={!!parseError}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          {parseError ? (
            <p className="text-xs text-[var(--color-danger)]" role="alert">
              {parseError}
            </p>
          ) : same ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Same as the current delegate.
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Rotating…" : "Rotate delegate"}
        </button>
      </form>
    </section>
  );
}
