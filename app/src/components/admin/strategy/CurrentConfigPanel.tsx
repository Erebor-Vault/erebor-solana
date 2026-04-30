"use client";

import { CopyButton } from "@/components/shared/CopyButton";
import { formatTokenAmount, truncateAddress } from "@/lib/format";
import type { StrategyData } from "@/hooks/useStrategies";
import { useVault } from "@/components/providers/VaultProvider";

export function CurrentConfigPanel({ strategy }: { strategy: StrategyData }) {
  const { activeEntry, vault } = useVault();
  const totalDeposited = vault?.totalDeposited.toNumber() || 0;
  const targetPct = strategy.targetWeightBps / 100;
  const targetAmt = totalDeposited > 0
    ? Math.floor((totalDeposited * strategy.targetWeightBps) / 10_000)
    : 0;
  const allocPct = totalDeposited > 0
    ? (strategy.allocatedAmount.toNumber() / totalDeposited) * 100
    : 0;

  const symbol = activeEntry.tokenSymbol;
  const decimals = activeEntry.tokenDecimals;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-4">
        <h3 className="text-base font-semibold">Current configuration</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Live read of the on-chain <code>StrategyAllocation</code> account.
        </p>
      </header>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Row label="Strategy ID">#{strategy.strategyId.toString()}</Row>
        <Row label="Status">
          {strategy.isActive ? (
            <span className="text-[var(--color-success)]">active</span>
          ) : (
            <span className="text-[var(--color-danger)]">inactive (permanent)</span>
          )}
        </Row>
        <Row label="Strategy PDA">
          <Mono value={strategy.publicKey.toBase58()} />
        </Row>
        <Row label="Token account">
          <Mono value={strategy.tokenAccount.toBase58()} />
        </Row>
        <Row label="Delegate (AI agent)">
          <Mono value={strategy.delegate.toBase58()} />
        </Row>
        <Row label="Target weight">
          {targetPct.toFixed(2)}% ({strategy.targetWeightBps} bps)
        </Row>
        <Row label="Allocated">
          {formatTokenAmount(strategy.allocatedAmount, decimals)} {symbol} ({allocPct.toFixed(1)}%)
        </Row>
        <Row label="Target amount">
          {formatTokenAmount(targetAmt, decimals)} {symbol}
        </Row>
        <Row label="Actual ATA balance">
          {formatTokenAmount(strategy.actualBalance, decimals)} {symbol}
        </Row>
        <Row label="Unreported yield">
          {strategy.actualBalance.gt(strategy.allocatedAmount) ? (
            <span className="text-[var(--color-success)]">
              +
              {formatTokenAmount(
                strategy.actualBalance.sub(strategy.allocatedAmount),
                decimals
              )}{" "}
              {symbol}
            </span>
          ) : (
            "—"
          )}
        </Row>
      </dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function Mono({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-[var(--color-text-secondary)]" title={value}>
        {truncateAddress(value, 6)}
      </span>
      <CopyButton value={value} ariaLabel="Copy address" />
    </span>
  );
}
