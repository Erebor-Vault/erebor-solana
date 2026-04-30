"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useVault } from "@/components/providers/VaultProvider";
import { useRoles } from "@/hooks/useRoles";
import { useStrategies } from "@/hooks/useStrategies";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { CopyButton } from "@/components/shared/CopyButton";
import { CurrentConfigPanel } from "@/components/admin/strategy/CurrentConfigPanel";
import { DelegateEditor } from "@/components/admin/strategy/DelegateEditor";
import { WeightEditor } from "@/components/admin/strategy/WeightEditor";
import { AuthorityActionsPanel } from "@/components/admin/strategy/AuthorityActionsPanel";
import { DeactivateStrategyButton } from "@/components/admin/strategy/DeactivateStrategyButton";
import { AllowedActionsEditor } from "@/components/admin/strategy/AllowedActionsEditor";
import { ReportLossButton } from "@/components/admin/strategy/ReportLossButton";
import { RedeemFromExternalButton } from "@/components/admin/strategy/RedeemFromExternalButton";
import { AutoActionConfigEditor } from "@/components/admin/strategy/AutoActionConfigEditor";
import { ValueSourceEditor } from "@/components/admin/strategy/ValueSourceEditor";
import { truncateAddress } from "@/lib/format";

export function StrategyAdminContent() {
  return (
    <AdminGuard>
      <Inner />
    </AdminGuard>
  );
}

function Inner() {
  const params = useParams<{ address: string; id: string }>();
  const idNum = Number(params?.id);
  const { activeEntry, vaultPda, hasActiveVault } = useVault();
  const { strategies, loading, refresh } = useStrategies();
  const roles = useRoles();

  if (!hasActiveVault) {
    return <UnknownVault />;
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-48 animate-pulse rounded bg-[var(--color-surface-secondary)]" />
        <div className="h-64 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]" />
      </div>
    );
  }

  const strategy = strategies.find((s) => s.strategyId.toNumber() === idNum);

  if (!strategy) {
    return (
      <div className="space-y-4">
        <BackLinks vaultPdaStr={vaultPda.toBase58()} />
        <div className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-10 text-center">
          <p className="text-[var(--color-warning)] mb-1">
            Strategy #{idNum} not found
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            This vault has {strategies.length} strategies. Pick one from the
            admin index, or create a new one.
          </p>
        </div>
      </div>
    );
  }

  const adminDisabled = !roles.isAdmin;
  const authorityDisabled = !roles.isAuthority;
  const pdaStr = strategy.publicKey.toBase58();
  const vaultPdaStr = vaultPda.toBase58();

  return (
    <div className="space-y-6">
      <BackLinks vaultPdaStr={vaultPdaStr} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Strategy {strategy.strategyId.toString()}
            </h1>
            <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
              {activeEntry.name}
            </span>
            {strategy.isActive ? (
              <span className="rounded-md border border-[var(--color-success)]/60 bg-[var(--color-success)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-success)]">
                active
              </span>
            ) : (
              <span className="rounded-md border border-[var(--color-danger)]/60 bg-[var(--color-danger)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]">
                inactive
              </span>
            )}
            {roles.isAdmin ? (
              <span className="rounded-md border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                admin
              </span>
            ) : null}
            {roles.isAuthority ? (
              <span className="rounded-md border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                authority
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-xs text-[var(--color-text-muted)]">
              {truncateAddress(pdaStr, 6)}
            </span>
            <CopyButton value={pdaStr} ariaLabel="Copy strategy PDA" />
          </div>
        </div>
      </header>

      {!roles.isAdmin && !roles.isAuthority ? (
        <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm text-[var(--color-warning)]">
          Read-only view. The connected wallet has neither the admin nor the
          authority role on this vault. Controls below are disabled.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <AllowedActionsEditor strategy={strategy} />
          <AutoActionConfigEditor strategy={strategy} />
          <ValueSourceEditor strategy={strategy} />
        </div>

        <div className="space-y-6">
          <CurrentConfigPanel strategy={strategy} />
          <DelegateEditor
            strategy={strategy}
            disabled={adminDisabled}
            onChanged={refresh}
          />
          <WeightEditor
            strategy={strategy}
            disabled={adminDisabled}
            onChanged={refresh}
          />
          <AuthorityActionsPanel
            strategy={strategy}
            disabled={authorityDisabled}
            onChanged={refresh}
          />
          <RedeemFromExternalButton
            strategy={strategy}
            decimals={activeEntry.tokenDecimals}
          />
          <ReportLossButton
            strategy={strategy}
            decimals={activeEntry.tokenDecimals}
          />
          <DeactivateStrategyButton
            strategy={strategy}
            disabled={adminDisabled}
            onChanged={refresh}
          />
        </div>
      </div>
    </div>
  );
}

function BackLinks({ vaultPdaStr }: { vaultPdaStr: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
      <Link
        href={`/vault/${vaultPdaStr}/admin`}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to admin
      </Link>
    </div>
  );
}

function UnknownVault() {
  return (
    <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-surface-secondary)] p-10 text-center">
      <p className="text-[var(--color-danger)] mb-2">Unknown vault</p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)]"
      >
        ← Back to vaults
      </Link>
    </div>
  );
}
