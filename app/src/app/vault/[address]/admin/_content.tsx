"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { StrategyList } from "@/components/admin/StrategyList";
import { CreateStrategyForm } from "@/components/admin/CreateStrategyForm";
import { AllocationChart } from "@/components/admin/AllocationChart";
import { PauseToggle } from "@/components/admin/PauseToggle";
import { PerformanceFeeEditor } from "@/components/admin/PerformanceFeeEditor";
import { AdminTransferFlow } from "@/components/admin/AdminTransferFlow";
import { AllowedTokensPanel } from "@/components/admin/AllowedTokensPanel";
import { PausedBanner } from "@/components/vault/PausedBanner";
import { ActivityFeed } from "@/components/vault/ActivityFeed";
import { CopyButton } from "@/components/shared/CopyButton";
import { useStrategies } from "@/hooks/useStrategies";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { useVault } from "@/components/providers/VaultProvider";
import { truncateAddress } from "@/lib/format";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

export function AdminPageContent() {
  return (
    <AdminGuard>
      <AdminContent />
    </AdminGuard>
  );
}

function AdminContent() {
  const { vault, activeEntry, vaultPda, hasActiveVault } = useVault();
  const { strategies, refresh } = useStrategies();
  const { rebalanceAll, loading: rebalanceLoading } = useAuthorityActions();
  const [rebalancing, setRebalancing] = useState(false);

  const activeStrategies = strategies.filter((s) => s.isActive);
  const totalWeight = activeStrategies.reduce((sum, s) => sum + s.targetWeightBps, 0);

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
      if (sigs.length > 0) {
        showTxSuccess(sigs[sigs.length - 1]);
      }
      await refresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setRebalancing(false);
    }
  };

  if (!hasActiveVault) {
    return (
      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-surface-secondary)] p-10 text-center">
        <p className="text-[var(--color-danger)]">Unknown vault</p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)]"
        >
          ← Back to vaults
        </Link>
      </div>
    );
  }

  const pdaStr = vaultPda.toBase58();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/vault/${pdaStr}`}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to vault
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                {activeEntry.name}
              </h1>
              <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                {activeEntry.tokenSymbol}
              </span>
              <span className="rounded-md border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                Admin
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                vault_id={activeEntry.vaultId} · {truncateAddress(pdaStr)}
              </span>
              <CopyButton value={pdaStr} ariaLabel="Copy vault address" />
            </div>
            {vault ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Admin: {truncateAddress(vault.admin.toBase58())} · Authority:{" "}
                {truncateAddress(vault.authority.toBase58())}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            {activeStrategies.length > 0 && (
              <button
                onClick={handleRebalanceAll}
                disabled={rebalancing || rebalanceLoading}
                className="rounded-lg bg-[var(--color-accent)]/20 px-4 py-2 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50 hover:bg-[var(--color-accent)]/30 transition-colors"
              >
                {rebalancing
                  ? "Rebalancing..."
                  : `Rebalance All (${(totalWeight / 100).toFixed(0)}% allocated)`}
              </button>
            )}
            <CreateStrategyForm onCreated={refresh} />
          </div>
        </div>
      </div>

      <PausedBanner />

      <div className="grid gap-6 lg:grid-cols-2">
        <PauseToggle />
        <PerformanceFeeEditor />
      </div>

      <AdminTransferFlow />

      <AllowedTokensPanel />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4">Strategies</h2>
          <StrategyList />
        </div>
        <div className="space-y-6">
          <AllocationChart />
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
