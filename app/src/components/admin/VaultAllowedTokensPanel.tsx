"use client";

import { useEffect, useMemo, useState } from "react";
import { useVaultAllowedTokens } from "@/hooks/useVaultAllowedTokens";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { CopyButton } from "@/components/shared/CopyButton";
import { truncateAddress } from "@/lib/format";
import { lookupTokenSymbol } from "@/lib/knownTokens";

/**
 * Per-vault token allow-list — slim form. Renders as one inline strip
 * with the currently-enabled symbols as chips and an `Edit` toggle that
 * expands a compact multi-select grid below. Curator-controlled (Option
 * B defense-in-depth alongside the global protocol allow-list).
 *
 * Designed to live above the Strategies grid: must take minimal vertical
 * space when collapsed (~40px) and read like a status row, not a
 * dedicated panel.
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

  const [open, setOpen] = useState(false);

  const initialSelected = useMemo(
    () =>
      new Set(
        candidates.filter((c) => c.enabled).map((c) => c.mint.toBase58())
      ),
    [candidates]
  );
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  const toggle = (mint: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(mint) ? next.delete(mint) : next.add(mint);
      return next;
    });

  const toAdd = [...selected].filter((m) => !initialSelected.has(m)).length;
  const toRemove = [...initialSelected].filter((m) => !selected.has(m)).length;
  const dirty = toAdd > 0 || toRemove > 0;

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

  // Sort enabled chips so the displayed order is stable across renders.
  const enabled = candidates.filter((c) => c.enabled);
  const VISIBLE = 5;
  const visibleChips = enabled.slice(0, VISIBLE);
  const overflow = Math.max(0, enabled.length - VISIBLE);

  return (
    <div
      className={`relative rounded-lg border bg-[var(--color-surface-secondary)]/60 transition-colors ${
        dirty
          ? "border-[var(--color-border)] border-l-[3px] border-l-[var(--color-accent)]"
          : "border-[var(--color-border)]"
      }`}
    >
      {/* Slim collapsed strip */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="eyebrow shrink-0">Allowed output tokens</span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {loading ? (
            <span className="text-xs text-[var(--color-text-muted)]">loading…</span>
          ) : enabled.length === 0 ? (
            <span className="text-xs italic text-[var(--color-text-muted)]">
              none enabled — swap-style actions will revert
            </span>
          ) : (
            <>
              {visibleChips.map((c) => {
                const mintStr = c.mint.toBase58();
                return (
                  <Chip key={mintStr} symbol={lookupTokenSymbol(mintStr)} mint={mintStr} />
                );
              })}
              {overflow > 0 && (
                <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                  +{overflow}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
            {counts.enabled}/{counts.protocol}
          </span>
          {dirty && !open && (
            <span className="font-mono text-[10px] tabular-nums text-[var(--color-accent)]">
              ·{" "}
              <span className="text-[var(--color-accent)]">+{toAdd}</span>
              <span className="text-[var(--color-warning)]">/−{toRemove}</span>{" "}
              pending
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-primary)]"
            aria-expanded={open}
          >
            {open ? "Done" : "Edit"}
            <Chevron open={open} />
          </button>
        </div>
      </div>

      {/* Expanded editor — opens inline below the strip */}
      {open && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)]/40 px-4 py-3">
          {candidates.length === 0 ? (
            <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
              No mints on the protocol allow-list yet. Governance must seed
              the list first (see <code>scripts/seed-allowed-tokens.ts</code>).
            </p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                {candidates.map((c) => {
                  const mintStr = c.mint.toBase58();
                  const isOn = selected.has(mintStr);
                  const symbol = lookupTokenSymbol(mintStr);
                  const willAdd = !c.enabled && isOn;
                  const willRemove = c.enabled && !isOn;
                  return (
                    <li key={mintStr}>
                      <label
                        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--color-surface-hover)] ${
                          (!isAdmin || submitting) && "cursor-not-allowed"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isOn}
                          disabled={!isAdmin || submitting}
                          onChange={() => toggle(mintStr)}
                          className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
                          aria-label={`Toggle ${symbol ?? mintStr}`}
                        />
                        <span className="min-w-0 flex-1 text-sm font-semibold tabular-nums">
                          {symbol ?? (
                            <span className="font-normal italic text-[var(--color-text-muted)]">
                              ?
                            </span>
                          )}
                        </span>
                        <span
                          className="truncate font-mono text-[10px] text-[var(--color-text-muted)]"
                          title={mintStr}
                        >
                          {truncateAddress(mintStr, 4)}
                        </span>
                        {willAdd && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" aria-label="will add" />
                        )}
                        {willRemove && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" aria-label="will remove" />
                        )}
                        <CopyButton value={mintStr} ariaLabel={`Copy ${symbol ?? "mint"} address`} />
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                <p className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
                  {dirty ? (
                    <>
                      <span className="text-[var(--color-accent)]">+{toAdd}</span>{" "}
                      /{" "}
                      <span className="text-[var(--color-warning)]">−{toRemove}</span>{" "}
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
                    className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? "applying…" : "Apply"}
                  </button>
                </div>
              </div>

              {!isAdmin && (
                <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                  Read-only — only the vault admin can change this list.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ symbol, mint }: { symbol: string | null; mint: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--color-accent)]"
      title={mint}
    >
      {symbol ?? truncateAddress(mint, 3)}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`text-[var(--color-text-muted)] transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
