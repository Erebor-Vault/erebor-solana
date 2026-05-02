"use client";

import { useEffect, useMemo, useState } from "react";
import { useVaultAllowedTokens } from "@/hooks/useVaultAllowedTokens";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { CopyButton } from "@/components/shared/CopyButton";
import { truncateAddress } from "@/lib/format";
import { lookupTokenSymbol } from "@/lib/knownTokens";

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
    <section
      className={`relative rounded-xl border bg-[var(--color-surface-secondary)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(212,162,74,0.08)] transition-colors ${
        dirty
          ? "border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)]"
          : "border-[var(--color-border)]"
      }`}
    >
      <header className="mb-4 flex items-baseline gap-3">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          Token allow-list
        </h3>
        <span className="eyebrow">Per vault</span>
      </header>
      <p className="mb-5 text-xs leading-relaxed text-[var(--color-text-muted)]">
        Curator-controlled subset of the protocol-level allow-list. When an
        allowed action declares an output mint, the program checks the mint
        is on <em>both</em> lists.
      </p>

      <details
        className="group rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
        open={candidates.length > 0}
      >
        <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium hover:bg-[var(--color-surface-secondary)]">
          <span className="flex items-center gap-2">
            <Chevron />
            Vault tokens
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
            {summary}
          </span>
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
            <ul
              className="grid max-h-72 gap-0.5 overflow-y-auto pr-1"
              style={{
                // Soft fade at the edges so the list reads as a scrollable
                // picker rather than a clipped block.
                maskImage:
                  "linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
              }}
            >
              {candidates.map((c) => {
                const mintStr = c.mint.toBase58();
                const isOn = selected.has(mintStr);
                const symbol = lookupTokenSymbol(mintStr);
                const willAdd = !c.enabled && isOn;
                const willRemove = c.enabled && !isOn;
                return (
                  <li
                    key={mintStr}
                    className="grid grid-cols-[auto,5rem,1fr,5rem,auto] items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--color-surface-secondary)]"
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      disabled={!isAdmin || submitting}
                      onChange={() => toggle(mintStr)}
                      aria-label={`Toggle ${symbol ?? mintStr}`}
                      className="h-4 w-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
                    />
                    <label
                      htmlFor={mintStr}
                      onClick={() => toggle(mintStr)}
                      className="cursor-pointer text-sm font-semibold tabular-nums"
                    >
                      {symbol ?? (
                        <span className="font-normal italic text-[var(--color-text-muted)]">
                          unknown
                        </span>
                      )}
                    </label>
                    <span
                      className="truncate font-mono text-[11px] text-[var(--color-text-muted)]"
                      title={mintStr}
                    >
                      {truncateAddress(mintStr, 6)}
                    </span>
                    <span className="text-right font-mono text-[10px] uppercase tracking-wider">
                      {willAdd && (
                        <span className="text-[var(--color-accent)]">
                          will add
                        </span>
                      )}
                      {willRemove && (
                        <span className="text-[var(--color-warning)]">
                          will remove
                        </span>
                      )}
                    </span>
                    <CopyButton
                      value={mintStr}
                      ariaLabel={`Copy ${symbol ?? "mint"} address`}
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {candidates.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
              <p className="font-mono text-[11px] tabular-nums text-[var(--color-text-muted)]">
                {dirty ? (
                  <>
                    <span className="text-[var(--color-accent)]">
                      +{toAddCount}
                    </span>{" "}
                    /{" "}
                    <span className="text-[var(--color-warning)]">
                      −{toRemoveCount}
                    </span>{" "}
                    pending
                  </>
                ) : (
                  "no changes pending"
                )}
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!dirty || submitting}
                  onClick={handleReset}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reset
                </button>
                <button
                  type="button"
                  disabled={!dirty || !isAdmin || submitting}
                  onClick={handleApply}
                  className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "applying…" : "Apply"}
                </button>
              </div>
            </div>
          )}

          {!isAdmin && (
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Read-only — only the vault admin can change this list.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[var(--color-text-muted)] transition-transform duration-200 group-open:rotate-90"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
