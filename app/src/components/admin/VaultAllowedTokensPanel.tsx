"use client";

import { useEffect, useMemo, useState } from "react";
import { useVaultAllowedTokens } from "@/hooks/useVaultAllowedTokens";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";
import { lookupTokenSymbol } from "@/lib/knownTokens";

/**
 * Per-vault token allow-list — slim, always-interactive chip row. Every
 * protocol-level mint renders as a chip; clicking toggles enabled state.
 * Apply / Reset surface only when the working set diverges from on-chain.
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

  // Resolve symbols on-chain via Metaplex Token Metadata. Cached per
  // session; falls back to the static built-in / env map when a mint
  // has no metadata account.
  const candidateMints = useMemo(() => candidates.map((c) => c.mint), [candidates]);
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="eyebrow shrink-0">Allowed output tokens</span>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
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
                <TokenChip
                  key={mintStr}
                  mint={mintStr}
                  symbol={symbol}
                  state={
                    willAdd
                      ? "will-add"
                      : willRemove
                      ? "will-remove"
                      : isOn
                      ? "on"
                      : "off"
                  }
                  disabled={!isAdmin || submitting}
                  onClick={() => toggle(mintStr)}
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

type ChipState = "on" | "off" | "will-add" | "will-remove";

function TokenChip({
  mint,
  symbol,
  state,
  disabled,
  onClick,
}: {
  mint: string;
  symbol: string | null;
  state: ChipState;
  disabled: boolean;
  onClick: () => void;
}) {
  const styles: Record<ChipState, string> = {
    on:
      "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25",
    off:
      "border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text-primary)]",
    "will-add":
      "border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-[var(--color-accent)] shadow-[0_0_8px_rgba(94,234,212,0.25)]",
    "will-remove":
      "border-[var(--color-warning)]/60 bg-[var(--color-warning)]/10 text-[var(--color-warning)] line-through decoration-[var(--color-warning)]/60",
  };
  const label = symbol ?? truncateAddress(mint, 3);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${symbol ? symbol + " · " : ""}${mint}\n${state.replace("-", " ")}`}
      aria-pressed={state === "on" || state === "will-add"}
      className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums transition-all disabled:cursor-not-allowed disabled:opacity-50 ${styles[state]}`}
    >
      {!symbol && (
        <span className="opacity-60" aria-hidden>
          ·
        </span>
      )}
      {label}
    </button>
  );
}
