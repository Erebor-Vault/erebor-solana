"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useVault } from "@/components/providers/VaultProvider";
import { useRoles } from "@/hooks/useRoles";
import { useAdminActions } from "@/hooks/useAdminActions";
import { truncateAddress } from "@/lib/format";

/**
 * Admin-only pause/unpause toggle. Renders for everyone but is `disabled`
 * unless the connected wallet matches `vault_state.admin` (disable-not-hide).
 */
export function PauseToggle() {
  const { vault } = useVault();
  const { isAdmin, connected } = useRoles();
  const { setPaused, loading } = useAdminActions();
  const [submitting, setSubmitting] = useState(false);

  const paused = !!vault?.paused;

  const handleClick = async () => {
    if (!isAdmin) return;
    setSubmitting(true);
    try {
      const sig = await setPaused(!paused);
      toast.success(
        `${paused ? "Unpaused" : "Paused"} • ${truncateAddress(sig)}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message.slice(0, 200));
    } finally {
      setSubmitting(false);
    }
  };

  const disabledReason = !connected
    ? "Connect a wallet to manage the pause flag"
    : !isAdmin
      ? "Admin only"
      : undefined;

  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold mb-1">
            Pause flag {paused && (
              <span className="ml-2 rounded-full bg-[var(--color-danger)]/20 px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]">
                paused
              </span>
            )}
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            When paused, the program rejects deposits, allocations, and
            rebalances. Withdrawals stay open.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={!isAdmin || loading || submitting}
          title={disabledReason}
          aria-disabled={!isAdmin}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            paused
              ? "bg-[var(--color-accent)] text-black hover:opacity-90"
              : "bg-[var(--color-danger)]/20 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/30"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {submitting
            ? "Submitting…"
            : paused
              ? "Unpause vault"
              : "Pause vault"}
        </button>
      </div>
    </div>
  );
}
