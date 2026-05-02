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
import { VaultAllowedTokensPanel } from "@/components/admin/VaultAllowedTokensPanel";
import { Zone } from "@/components/admin/Zone";
import { PausedBanner } from "@/components/vault/PausedBanner";
import { ActivityFeed } from "@/components/vault/ActivityFeed";
import { CopyButton } from "@/components/shared/CopyButton";
import { useStrategies } from "@/hooks/useStrategies";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { useRoles } from "@/hooks/useRoles";
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
  const { isAdmin, isAuthority } = useRoles();
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
    <div className="space-y-12">
      {/* Header — three layers, framed by corner ornaments to evoke the
          deck's inscribed armor-plate framing. */}
      <header className="relative space-y-5 px-1">
        <CornerOrnaments />

        <Link
          href={`/vault/${pdaStr}`}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to vault
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl font-semibold tracking-tight forge-glow">
                {activeEntry.name}
              </h1>
              <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                {activeEntry.tokenSymbol}
              </span>
              {isAdmin && (
                <span className="rounded-md border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                  Admin
                </span>
              )}
              {isAuthority && (
                <span className="rounded-md border border-[var(--color-accent-secondary)]/60 bg-[var(--color-accent-secondary)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-accent-secondary)]">
                  Authority
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                vault_id={activeEntry.vaultId} · {truncateAddress(pdaStr)}
              </span>
              <CopyButton value={pdaStr} ariaLabel="Copy vault address" />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {activeStrategies.length > 0 && (
              <button
                onClick={handleRebalanceAll}
                disabled={rebalancing || rebalanceLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-accent-secondary)]/30 bg-[var(--color-accent-secondary)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent-secondary)] transition-colors hover:border-[var(--color-accent-secondary)]/60 hover:bg-[var(--color-accent-secondary)]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rebalancing ? "Rebalancing…" : "Rebalance"}
                <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                  {(totalWeight / 100).toFixed(0)}%
                </span>
              </button>
            )}
            <CreateStrategyForm onCreated={refresh} />
          </div>
        </div>

        {vault ? (
          <dl className="grid grid-cols-1 gap-x-10 gap-y-1 border-t border-[var(--color-border)] pt-4 sm:grid-cols-2">
            <PubkeyRow
              label="Admin"
              tone="admin"
              value={vault.admin.toBase58()}
            />
            <PubkeyRow
              label="Authority"
              tone="authority"
              value={vault.authority.toBase58()}
            />
          </dl>
        ) : null}
      </header>

      <PausedBanner />

      <Zone eyebrow="Operations">
        <div className="grid gap-4 lg:grid-cols-2">
          <PauseToggle />
          <PerformanceFeeEditor />
        </div>
        <AdminTransferFlow />
      </Zone>

      <Zone eyebrow="Allocation">
        <VaultAllowedTokensPanel />
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <StrategyList />
          </div>
          <div>
            <AllocationChart />
          </div>
        </div>
      </Zone>

      <Zone eyebrow="Audit">
        <ActivityFeed />
      </Zone>
    </div>
  );
}

function PubkeyRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "admin" | "authority";
}) {
  const dotClass =
    tone === "admin"
      ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(94,234,212,0.55)]"
      : "bg-[var(--color-accent-secondary)] shadow-[0_0_8px_rgba(212,162,74,0.5)]";
  return (
    <div className="flex items-center gap-3">
      <dt className="flex w-24 shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-[var(--color-text-secondary)]">
        <span className="truncate" title={value}>
          {truncateAddress(value, 6)}
        </span>
        <CopyButton value={value} ariaLabel={`Copy ${label.toLowerCase()} address`} />
      </dd>
    </div>
  );
}

/** Four small geometric flourishes pinned to the corners of the header
 *  block. Picks up the deck's "inscribed armor plate" framing language
 *  without any literal skeumorphism. */
function CornerOrnaments() {
  const corners = [
    "top-0 left-0",
    "top-0 right-0 rotate-90",
    "bottom-0 right-0 rotate-180",
    "bottom-0 left-0 -rotate-90",
  ];
  return (
    <>
      {corners.map((cls, i) => (
        <span
          key={i}
          aria-hidden
          className={`pointer-events-none absolute ${cls} block`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            className="text-[var(--color-accent-secondary)]/50"
          >
            <path
              d="M0 6 L0 0 L6 0"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
            <circle cx="0" cy="0" r="1" fill="currentColor" />
          </svg>
        </span>
      ))}
    </>
  );
}
