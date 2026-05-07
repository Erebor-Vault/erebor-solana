"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useVault } from "@/components/providers/VaultProvider";
import { useRoles } from "@/hooks/useRoles";
import { useAdminActions } from "@/hooks/useAdminActions";
import { truncateAddress } from "@/lib/format";

const MAX_BPS = 2000;

/**
 * Admin-only performance fee editor. Lets the admin change the per-vault
 * `performance_fee_bps` within the program's hard cap (20%). Disable-not-hide:
 * non-admins see the slider but can't move it. See docs/OVERVIEW.md §11.
 */
export function PerformanceFeeEditor() {
  const { vault } = useVault();
  const { isAdmin, connected } = useRoles();
  const { setPerformanceFeeBps, loading } = useAdminActions();
  const [draft, setDraft] = useState<number>(vault?.performanceFeeBps ?? 500);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (vault?.performanceFeeBps !== undefined) {
      setDraft(vault.performanceFeeBps);
    }
  }, [vault?.performanceFeeBps]);

  const current = vault?.performanceFeeBps ?? 0;
  const dirty = draft !== current;
  const canSubmit = !!isAdmin && !loading && !submitting && dirty && draft >= 0 && draft <= MAX_BPS;

  const onSave = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const sig = await setPerformanceFeeBps(draft);
      toast.success(`Performance fee → ${(draft / 100).toFixed(2)}% • ${truncateAddress(sig)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message.slice(0, 200));
    } finally {
      setSubmitting(false);
    }
  };

  const disabledReason = !connected
    ? "Connect a wallet to change the performance fee"
    : !isAdmin
      ? "Admin only"
      : undefined;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-5">
      <header className="mb-4">
        <h3 className="text-base font-semibold">
          Performance fee
          <span className="ml-2 rounded-full bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)] tabular-nums">
            {(current / 100).toFixed(2)}% · {current} bps
          </span>
        </h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Charged at <code>withdraw</code> time on the redeemed amount; routed
          to the admin&apos;s ATA. Default 500 bps (5%); cap {MAX_BPS} bps (20%).
        </p>
      </header>

      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          {(draft / 100).toFixed(2)}%
        </span>
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {draft} bps
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={MAX_BPS}
        step={25}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        disabled={!isAdmin || submitting}
        className="w-full accent-[var(--color-accent)] disabled:opacity-50"
        aria-label="Performance fee in basis points"
        title={disabledReason}
      />
      <div className="mt-1 grid grid-cols-5 text-[10px] text-[var(--color-text-muted)]">
        <span className="text-left">0%</span>
        <span className="text-center">5%</span>
        <span className="text-center">10%</span>
        <span className="text-center">15%</span>
        <span className="text-right">20%</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSubmit}
          aria-disabled={!isAdmin}
          title={disabledReason}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={() => setDraft(current)}
            disabled={submitting}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}
