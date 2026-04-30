"use client";

import { useVault } from "@/components/providers/VaultProvider";

/**
 * Banner shown across the dashboard whenever the active vault has the pause
 * flag set. While paused, the program rejects deposits, allocations, and
 * rebalances; withdrawals stay open.
 */
export function PausedBanner() {
  const { vault } = useVault();

  if (!vault?.paused) return null;

  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm"
    >
      <span aria-hidden="true" className="text-[var(--color-danger)]">
        ⏸
      </span>
      <div>
        <p className="font-medium text-[var(--color-danger)]">
          This vault is paused
        </p>
        <p className="text-[var(--color-text-secondary)]">
          Deposits, allocations, and rebalances are blocked until an admin
          unpauses. Withdrawals remain open.
        </p>
      </div>
    </div>
  );
}
