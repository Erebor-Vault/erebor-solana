"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type { StrategyData } from "@/hooks/useStrategies";
import {
  useValueSources,
  VALUE_SOURCE_KIND_SPL_ATA_BALANCE,
  VALUE_SOURCE_KIND_ACCOUNT_U64,
  MAX_VALUE_SOURCES_PER_STRATEGY,
} from "@/hooks/useValueSources";
import { useRoles } from "@/hooks/useRoles";
import { CopyButton } from "@/components/shared/CopyButton";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";

interface Props {
  strategy: StrategyData;
  disabled?: boolean;
}

const KIND_LABEL: Record<number, string> = {
  [VALUE_SOURCE_KIND_SPL_ATA_BALANCE]: "SPL ATA balance",
  [VALUE_SOURCE_KIND_ACCOUNT_U64]: "Account u64",
};

/**
 * Per-strategy value-source registry. Each registered slot contributes
 * to the strategy's live NAV; `Settle now` (authority-only) reads the
 * registry, sums into a `computed_value`, and books the signed delta
 * into both `strategy.allocated_amount` and `vault.total_deposited`.
 */
export function ValueSourceEditor({ strategy, disabled }: Props) {
  const { rows, loading, submitting, nextFreeIndex, addSource, removeSource, settle } =
    useValueSources(strategy.publicKey, strategy.strategyId);
  const { isAuthority } = useRoles();

  const [kind, setKind] = useState<number>(VALUE_SOURCE_KIND_SPL_ATA_BALANCE);
  const [target, setTarget] = useState("");
  const [offsetStr, setOffsetStr] = useState("0");
  const [scaleNumStr, setScaleNumStr] = useState("1");
  const [scaleDenStr, setScaleDenStr] = useState("1");
  const [busy, setBusy] = useState(false);

  const free = nextFreeIndex();

  // Parse + validate.
  let targetParsed: PublicKey | null = null;
  let targetError: string | null = null;
  if (target.trim()) {
    try {
      targetParsed = new PublicKey(target.trim());
    } catch {
      targetError = "Not a valid base58 pubkey";
    }
  } else {
    targetError = "Required";
  }

  const offsetParsed = parseUintOrNull(offsetStr);
  const offsetError =
    kind === VALUE_SOURCE_KIND_ACCOUNT_U64 && offsetParsed === null
      ? "Required (non-negative integer)"
      : null;

  const scaleNumParsed = parseBnOrNull(scaleNumStr);
  const scaleNumError = scaleNumParsed === null ? "Need a non-negative integer" : null;
  const scaleDenParsed = parseBnOrNull(scaleDenStr);
  const scaleDenError =
    scaleDenParsed === null
      ? "Need a non-negative integer"
      : scaleDenParsed.isZero()
      ? "Must be non-zero"
      : null;

  const canAdd =
    !disabled &&
    !busy &&
    !submitting &&
    free !== null &&
    targetParsed !== null &&
    scaleNumParsed !== null &&
    scaleDenParsed !== null &&
    !scaleDenParsed.isZero() &&
    (kind === VALUE_SOURCE_KIND_SPL_ATA_BALANCE || offsetParsed !== null);

  const handleAdd = async () => {
    if (free === null || !targetParsed || !scaleNumParsed || !scaleDenParsed) return;
    setBusy(true);
    try {
      const sig = await addSource({
        index: free,
        kind,
        targetAccount: targetParsed,
        offset: kind === VALUE_SOURCE_KIND_ACCOUNT_U64 ? offsetParsed ?? 0 : 0,
        scaleNum: scaleNumParsed,
        scaleDen: scaleDenParsed,
      });
      showTxSuccess(sig);
      setTarget("");
      setOffsetStr("0");
      setScaleNumStr("1");
      setScaleDenStr("1");
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (index: number) => {
    setBusy(true);
    try {
      const sig = await removeSource(index);
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSettle = async () => {
    setBusy(true);
    try {
      const sig = await settle(strategy.tokenAccount);
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">
            Value sources — strategy {strategy.strategyId.toString()}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Up to {MAX_VALUE_SOURCES_PER_STRATEGY} sources per strategy.{" "}
            <code>Settle now</code> reads them, sums into a live{" "}
            <code>computed_value</code>, and books the delta into{" "}
            <code>allocated_amount</code> + <code>total_deposited</code>.
          </p>
        </div>
        {loading && <span className="text-xs text-[var(--color-text-muted)]">loading…</span>}
      </header>

      {/* Existing slots */}
      <div className="mb-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Registered ({rows.length}/{MAX_VALUE_SOURCES_PER_STRATEGY})
        </p>
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            No value sources yet. Add one below to start tracking live NAV.
          </div>
        ) : (
          <ul className="grid gap-2">
            {rows.map((r) => (
              <li
                key={r.index}
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              >
                <div className="grid gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                      [{r.index}]
                    </span>
                    <span className="font-semibold">
                      {KIND_LABEL[r.kind] ?? `kind=${r.kind}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <code className="font-mono">
                      {truncateAddress(r.targetAccount.toBase58(), 6)}
                    </code>
                    <CopyButton value={r.targetAccount.toBase58()} />
                    {r.kind === VALUE_SOURCE_KIND_ACCOUNT_U64 && (
                      <span>· offset {r.offset}</span>
                    )}
                    {(!r.scaleNum.eq(new BN(1)) || !r.scaleDen.eq(new BN(1))) && (
                      <span>
                        · scale {r.scaleNum.toString()}/{r.scaleDen.toString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={disabled || busy || submitting}
                  onClick={() => handleRemove(r.index)}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form */}
      {free !== null ? (
        <fieldset className="mb-4 rounded-md border border-[var(--color-border)] p-4">
          <legend className="px-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            Add source (slot {free})
          </legend>
          <div className="grid gap-3">
            <Field label="Kind">
              <select
                value={kind}
                onChange={(e) => setKind(Number(e.target.value))}
                disabled={disabled || busy}
                className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value={VALUE_SOURCE_KIND_SPL_ATA_BALANCE}>
                  SPL ATA balance — read SPL token account `amount`
                </option>
                <option value={VALUE_SOURCE_KIND_ACCOUNT_U64}>
                  Account u64 — read u64 at offset
                </option>
              </select>
            </Field>

            <Field label="Target account" error={targetError}>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={disabled || busy}
                placeholder="Base58 pubkey"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
              />
            </Field>

            {kind === VALUE_SOURCE_KIND_ACCOUNT_U64 && (
              <Field label="Byte offset" error={offsetError}>
                <input
                  type="text"
                  value={offsetStr}
                  onChange={(e) => setOffsetStr(e.target.value)}
                  disabled={disabled || busy}
                  placeholder="0"
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Scale numerator"
                error={scaleNumError}
                hint="Default 1"
              >
                <input
                  type="text"
                  value={scaleNumStr}
                  onChange={(e) => setScaleNumStr(e.target.value)}
                  disabled={disabled || busy}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
                />
              </Field>
              <Field
                label="Scale denominator"
                error={scaleDenError}
                hint="Default 1"
              >
                <input
                  type="text"
                  value={scaleDenStr}
                  onChange={(e) => setScaleDenStr(e.target.value)}
                  disabled={disabled || busy}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
                />
              </Field>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!canAdd}
                onClick={handleAdd}
                className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "adding…" : `Add to slot ${free}`}
              </button>
            </div>
          </div>
        </fieldset>
      ) : (
        <div className="mb-4 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
          All {MAX_VALUE_SOURCES_PER_STRATEGY} slots are occupied. Remove one
          to free a slot before adding a new source.
        </div>
      )}

      {/* Settle button — authority-only */}
      <div className="rounded-md border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Settle strategy value</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {isAuthority
                ? "Authority-only. Reads the registry above and books the signed delta."
                : "Authority-only — connect the authority wallet to enable."}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || busy || submitting || !isAuthority || rows.length === 0}
            onClick={handleSettle}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold hover:bg-[var(--color-surface-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "settling…" : "Settle now"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
      {!error && hint && (
        <span className="text-xs text-[var(--color-text-muted)]">{hint}</span>
      )}
    </div>
  );
}

function parseUintOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : null;
}

function parseBnOrNull(s: string): BN | null {
  const t = s.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return null;
  try {
    return new BN(t);
  } catch {
    return null;
  }
}
