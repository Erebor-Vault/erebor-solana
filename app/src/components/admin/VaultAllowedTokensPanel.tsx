"use client";

import { useEffect, useMemo, useState } from "react";
import { useVaultAllowedTokens } from "@/hooks/useVaultAllowedTokens";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";
import { lookupTokenSymbol } from "@/lib/knownTokens";

/**
 * Per-vault token allow-list — slim, always-interactive checkbox row.
 * Each protocol-level mint renders as `[☑ SYMBOL]` inline; the row
 * wraps as needed. Click anywhere on the label OR the box to toggle.
 *
 * Symbol resolution: Metaplex metadata → env map → built-in mainnet →
 * truncated mint fallback (in mono).
 *
 * Curator-controlled (Option B defense-in-depth alongside the global
 * protocol allow-list).
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

  const candidateMints = useMemo(
    () => candidates.map((c) => c.mint),
    [candidates]
  );
  const metadataSymbols = useTokenMetadata(candidateMints);
  const resolveSymbol = (mint: string): string | null =>
    metadataSymbols[mint] ?? lookupTokenSymbol(mint);

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

  return (
    <div
      className={`relative rounded-lg border bg-[var(--color-surface-secondary)]/60 transition-colors ${
        dirty
          ? "border-[var(--color-border)] border-l-[3px] border-l-[var(--color-accent)]"
          : "border-[var(--color-border)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span className="eyebrow shrink-0">Allowed output tokens</span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          {loading ? (
            <span className="text-xs text-[var(--color-text-muted)]">
              loading…
            </span>
          ) : candidates.length === 0 ? (
            <span className="text-xs italic text-[var(--color-text-muted)]">
              No mints on the protocol allow-list yet.
            </span>
          ) : (
            candidates.map((c) => {
              const mintStr = c.mint.toBase58();
              const isOn = selected.has(mintStr);
              const symbol = resolveSymbol(mintStr);
              const willAdd = !c.enabled && isOn;
              const willRemove = c.enabled && !isOn;
              return (
                <CheckItem
                  key={mintStr}
                  mint={mintStr}
                  symbol={symbol}
                  checked={isOn}
                  willAdd={willAdd}
                  willRemove={willRemove}
                  disabled={!isAdmin || submitting}
                  onChange={() => toggle(mintStr)}
                />
              );
            })
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
            {counts.enabled}/{counts.protocol}
          </span>
          {dirty && (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={handleReset}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset
              </button>
              <button
                type="button"
                disabled={!isAdmin || submitting}
                onClick={handleApply}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting
                  ? "applying…"
                  : `Apply +${toAdd}/−${toRemove}`}
              </button>
            </>
          )}
        </div>
      </div>

      {!isAdmin && candidates.length > 0 && (
        <p className="border-t border-[var(--color-border)] px-4 py-1.5 text-[10px] text-[var(--color-text-muted)]">
          Read-only — only the vault admin can change this list.
        </p>
      )}
    </div>
  );
}

function CheckItem({
  mint,
  symbol,
  checked,
  willAdd,
  willRemove,
  disabled,
  onChange,
}: {
  mint: string;
  symbol: string | null;
  checked: boolean;
  willAdd: boolean;
  willRemove: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  // Color and decoration follow state:
  // - on (settled): cyan symbol
  // - off (settled): muted symbol
  // - will-add (off → on): cyan with subtle glow
  // - will-remove (on → off): warning + line-through
  const labelClass = willRemove
    ? "text-[var(--color-warning)] line-through decoration-[var(--color-warning)]/60"
    : willAdd
      ? "text-[var(--color-accent)] [text-shadow:0_0_8px_rgba(94,234,212,0.35)]"
      : checked
        ? "text-[var(--color-accent)]"
        : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]";

  return (
    <label
      title={`${symbol ? symbol + " · " : ""}${mint}`}
      className={`group inline-flex cursor-pointer items-center gap-1.5 select-none transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
        aria-label={`Allow ${symbol ?? mint}`}
      />
      <span className={`text-xs font-medium tabular-nums ${labelClass}`}>
        {symbol ?? (
          <span className="font-mono text-[10px]">{truncateAddress(mint, 4)}</span>
        )}
      </span>
    </label>
  );
}
