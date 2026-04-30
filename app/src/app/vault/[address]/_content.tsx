"use client";

import { useState } from "react";
import Link from "next/link";
import { useVault } from "@/components/providers/VaultProvider";
import { useRoles } from "@/hooks/useRoles";
import { VaultStats } from "@/components/vault/VaultStats";
import { UserPosition } from "@/components/vault/UserPosition";
import { DepositForm } from "@/components/vault/DepositForm";
import { WithdrawForm } from "@/components/vault/WithdrawForm";
import { AllocationChart } from "@/components/admin/AllocationChart";
import { PausedBanner } from "@/components/vault/PausedBanner";
import { PendingRoleBanner } from "@/components/vault/PendingRoleBanner";
import { ActivityFeed } from "@/components/vault/ActivityFeed";
import { CopyButton } from "@/components/shared/CopyButton";
import { truncateAddress } from "@/lib/format";

export function VaultDetailContent() {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const { activeEntry, hasActiveVault, vaultPda, error } = useVault();
  const roles = useRoles();
  const showAdmin = roles.isAdmin || roles.isAuthority;

  if (!hasActiveVault) {
    return (
      <div className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-surface-secondary)] p-10 text-center">
        <p className="text-[var(--color-danger)] mb-2">Unknown vault</p>
        <p className="text-sm text-[var(--color-text-muted)]">
          The address in the URL does not match any registered vault.
        </p>
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
          href="/"
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to vaults
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
              {error ? (
                <span className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]">
                  unreachable
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                vault_id={activeEntry.vaultId} · {truncateAddress(pdaStr)}
              </span>
              <CopyButton value={pdaStr} ariaLabel="Copy vault address" />
            </div>
          </div>
          {showAdmin ? (
            <Link
              href={`/vault/${pdaStr}/admin`}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-4 py-2 text-sm font-medium hover:border-[var(--color-accent)]/60"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Admin
            </Link>
          ) : null}
        </div>
      </div>

      <PendingRoleBanner />

      <PausedBanner />

      <VaultStats />

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
            <div className="flex gap-1 mb-6">
              <button
                onClick={() => setTab("deposit")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  tab === "deposit"
                    ? "bg-[var(--color-accent)] text-black"
                    : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                Deposit
              </button>
              <button
                onClick={() => setTab("withdraw")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  tab === "withdraw"
                    ? "bg-[var(--color-accent-secondary)] text-white"
                    : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                Withdraw
              </button>
            </div>
            {tab === "deposit" ? <DepositForm /> : <WithdrawForm />}
          </div>
          <UserPosition />
        </div>
        <AllocationChart />
      </div>

      <ActivityFeed />
    </div>
  );
}
