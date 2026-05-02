"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useVaultAllowedTokens } from "@/hooks/useVaultAllowedTokens";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { CopyButton } from "@/components/shared/CopyButton";
import { truncateAddress } from "@/lib/format";

/**
 * Per-vault token allow-list editor — admin-controlled (Option B
 * defense-in-depth alongside the global protocol allow-list).
 *
 * UI: a collapsible <details> dropdown with a multi-select checkbox list
 * over the protocol-level mints. Already-enabled mints render checked.
 * Admin toggles checkboxes and clicks "Apply" to converge the on-chain
 * state to the selection in a single transaction (chunked at 8 ixs/tx
 * if needed).
 */
export function VaultAllowedTokensPanel() {
  const {
    candidates,
    loading,
    submitting,
    isAdmin,
    applyDiff,
    counts,
  } = useVaultAllowedTokens();

  // Local working set of mint base58 strings — initialised from the
  // server-side `enabled` flags and edited freely until the user hits
  // Apply or Reset.
  const initialSelected = useMemo(
    () =>
      new Set(
        candidates.filter((c) => c.enabled).map((c) => c.mint.toBase58())
      ),
    [candidates]
  );
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  // Re-sync the working set when the server data changes.
  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  const toggle = (mint: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mint)) next.delete(mint);
      else next.add(mint);
      return next;
    });
  };

  // Diff against the original `enabled` flags.
  const initial = initialSelected;
  const toAddCount = [...selected].filter((m) => !initial.has(m)).length;
  const toRemoveCount = [...initial].filter((m) => !selected.has(m)).length;
  const dirty = toAddCount > 0 || toRemoveCount > 0;

  const handleApply = async () => {
    try {
      const target = candidates
        .filter((c) => selected.has(c.mint.toBase58()))
        .map((c) => c.mint);
      const sig = await applyDiff(target);
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    }
  };

  const handleReset = () => setSelected(initialSelected);

  const summary = loading
    ? "loading…"
    : counts.protocol === 0
    ? "no protocol-level mints"
    : `${counts.enabled} of ${counts.protocol} enabled`;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-3">
        <h3 className="text-base font-semibold">Token allow-list (this vault)</h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Admin-controlled subset of the protocol-level allow-list. When an
          AllowedAction declares an <code>output_mint_index</code>, the
          program checks the swap-output mint is on <em>both</em> lists.
          Pick the subset of protocol-approved mints that this vault
          permits.
        </p>
      </header>

      <details
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
        // Default to open when there's anything to show, so admins land on
        // an actionable view without an extra click.
        open={candidates.length > 0}
      >
        <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-secondary)]">
          <span>Vault tokens</span>
          <span className="text-xs text-[var(--color-text-muted)]">{summary}</span>
        </summary>

        <div className="border-t border-[var(--color-border)] p-3">
          {loading ? (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
              Loading…
            </p>
          ) : candidates.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
              No mints on the protocol allow-list yet. Governance must seed
              the list first (see <code>scripts/seed-allowed-tokens.ts</code>).
            </p>
          ) : (
            <ul className="grid max-h-72 gap-1 overflow-y-auto pr-1">
              {candidates.map((c) => {
                const mintStr = c.mint.toBase58();
                const isOn = selected.has(mintStr);
                return (
                  <li
                    key={mintStr}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-secondary)]"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={isOn}
                        disabled={!isAdmin || submitting}
                        onChange={() => toggle(mintStr)}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
                      />
                      <span
                        className="font-mono text-xs"
                        title={mintStr}
                      >
                        {truncateAddress(mintStr, 8)}
                      </span>
                      {c.enabled && !isOn && (
                        <span className="text-xs text-[var(--color-warning)]">
                          (will remove)
                        </span>
                      )}
                      {!c.enabled && isOn && (
                        <span className="text-xs text-[var(--color-accent)]">
                          (will add)
                        </span>
                      )}
                    </label>
                    <CopyButton value={mintStr} ariaLabel="Copy mint" />
                  </li>
                );
              })}
            </ul>
          )}

          {candidates.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                {dirty ? (
                  <>
                    Pending: <span className="text-[var(--color-accent)]">+{toAddCount}</span>{" "}
                    add{toAddCount === 1 ? "" : "s"},{" "}
                    <span className="text-[var(--color-warning)]">-{toRemoveCount}</span>{" "}
                    remove{toRemoveCount === 1 ? "" : "s"}
                  </>
                ) : (
                  "No changes pending"
                )}
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!dirty || submitting}
                  onClick={handleReset}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
                <button
                  type="button"
                  disabled={!dirty || !isAdmin || submitting}
                  onClick={handleApply}
                  className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "applying…" : "Apply"}
                </button>
              </div>
            </div>
          )}

          {!isAdmin && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Read-only — only the vault admin can change this list.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
