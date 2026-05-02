"use client";

import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import type { StrategyData } from "@/hooks/useStrategies";
import {
  useAutoActionConfigs,
  AUTO_ACTION_KIND_DEPOSIT,
  AUTO_ACTION_KIND_WITHDRAW,
  MAX_AUTO_ACTION_IX_DATA_LEN,
  type AutoActionConfigRow,
} from "@/hooks/useAutoActionConfigs";
import { useAllowedActions } from "@/hooks/useAllowedActions";
import { hexToDiscriminator, discriminatorToHex } from "@/lib/actionPresets";
import { CopyButton } from "@/components/shared/CopyButton";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";

interface Props {
  strategy: StrategyData;
  disabled?: boolean;
}

/**
 * Auto-action config editor — declarative `(target, disc, ix_data)`
 * record per (strategy, kind). Read off-chain by the agent today;
 * on-chain auto-CPI inside `deposit` / `withdraw` is a future phase.
 */
export function AutoActionConfigEditor({ strategy, disabled }: Props) {
  const { rows, loading, submitting, setConfig, clearConfig } =
    useAutoActionConfigs(strategy.publicKey, strategy.strategyId);

  const deposit = useMemo(
    () => rows.find((r) => r.kind === AUTO_ACTION_KIND_DEPOSIT) ?? null,
    [rows]
  );
  const withdraw = useMemo(
    () => rows.find((r) => r.kind === AUTO_ACTION_KIND_WITHDRAW) ?? null,
    [rows]
  );

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">
            Auto-action config — strategy {strategy.strategyId.toString()}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Declares the action the agent should run when funds enter
            (deposit) or leave (withdraw) this strategy. Read off-chain
            today; on-chain auto-CPI is a planned follow-up.
          </p>
        </div>
        {loading && <span className="text-xs text-[var(--color-text-muted)]">loading…</span>}
      </header>

      <div className="grid gap-4">
        <ConfigSlot
          kind={AUTO_ACTION_KIND_DEPOSIT}
          kindLabel="Deposit"
          existing={deposit}
          strategy={strategy}
          submitting={submitting}
          disabled={!!disabled}
          onSet={setConfig}
          onClear={clearConfig}
        />
        <ConfigSlot
          kind={AUTO_ACTION_KIND_WITHDRAW}
          kindLabel="Withdraw"
          existing={withdraw}
          strategy={strategy}
          submitting={submitting}
          disabled={!!disabled}
          onSet={setConfig}
          onClear={clearConfig}
        />
      </div>
    </section>
  );
}

interface SlotProps {
  kind: number;
  kindLabel: string;
  existing: AutoActionConfigRow | null;
  strategy: StrategyData;
  submitting: boolean;
  disabled: boolean;
  onSet: (params: {
    kind: number;
    targetProgram: PublicKey;
    discriminator: number[];
    ixData: Uint8Array;
  }) => Promise<string>;
  onClear: (kind: number) => Promise<string>;
}

function ConfigSlot({
  kind,
  kindLabel,
  existing,
  strategy,
  submitting,
  disabled,
  onSet,
  onClear,
}: SlotProps) {
  const { rows: allowedActions, loading: loadingAllowed } = useAllowedActions(
    strategy.publicKey
  );
  const [allowedActionKey, setAllowedActionKey] = useState<string>("");
  const [ixDataHex, setIxDataHex] = useState("");
  const [target, setTarget] = useState("");
  const [discHex, setDiscHex] = useState("");
  const [busy, setBusy] = useState(false);

  // When the user picks a registered allowed action, autofill target + disc.
  const onPickAllowed = (key: string) => {
    setAllowedActionKey(key);
    if (!key) return;
    const row = allowedActions.find((a) => a.publicKey.toBase58() === key);
    if (row) {
      setTarget(row.targetProgram.toBase58());
      setDiscHex(discriminatorToHex(row.discriminator));
    }
  };

  // Parse + validate.
  let targetParsed: PublicKey | null = null;
  let targetError: string | null = null;
  if (target.trim()) {
    try {
      targetParsed = new PublicKey(target.trim());
    } catch {
      targetError = "Not a valid base58 program id";
    }
  } else {
    targetError = "Required";
  }

  const discBytes = discHex.trim() === "" ? null : hexToDiscriminator(discHex.trim());
  const discError =
    discHex.trim() === ""
      ? "Required (8 bytes / 16 hex chars)"
      : discBytes === null
      ? "Need 8 bytes (16 hex chars)"
      : null;

  let ixData: Uint8Array | null = null;
  let ixDataError: string | null = null;
  const trimmedHex = ixDataHex.trim().replace(/^0x/i, "");
  if (trimmedHex === "") {
    ixData = new Uint8Array();
  } else if (!/^[0-9a-f]*$/i.test(trimmedHex) || trimmedHex.length % 2 !== 0) {
    ixDataError = "Hex string with even length";
  } else {
    const bytes = new Uint8Array(trimmedHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(trimmedHex.slice(i * 2, i * 2 + 2), 16);
    }
    if (bytes.length > MAX_AUTO_ACTION_IX_DATA_LEN) {
      ixDataError = `Exceeds ${MAX_AUTO_ACTION_IX_DATA_LEN} byte cap`;
    } else {
      ixData = bytes;
    }
  }

  const canSave =
    !disabled &&
    !busy &&
    !submitting &&
    targetParsed !== null &&
    discBytes !== null &&
    ixData !== null &&
    !existing; // can't overwrite — clear first

  const handleSave = async () => {
    if (!targetParsed || !discBytes || !ixData) return;
    setBusy(true);
    try {
      const sig = await onSet({
        kind,
        targetProgram: targetParsed,
        discriminator: discBytes,
        ixData,
      });
      showTxSuccess(sig);
      setAllowedActionKey("");
      setTarget("");
      setDiscHex("");
      setIxDataHex("");
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      const sig = await onClear(kind);
      showTxSuccess(sig);
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="rounded-md border border-[var(--color-border)] p-4">
      <legend className="px-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {kindLabel} (kind = {kind})
      </legend>

      {existing ? (
        <div className="grid gap-2 text-sm">
          <Row label="Target program">
            <code className="font-mono text-xs">
              {truncateAddress(existing.targetProgram.toBase58(), 8)}
            </code>
            <CopyButton value={existing.targetProgram.toBase58()} />
          </Row>
          <Row label="Discriminator">
            <code className="font-mono text-xs">
              {discriminatorToHex(existing.discriminator)}
            </code>
          </Row>
          <Row label="ix_data">
            <code className="font-mono text-xs break-all">
              {existing.ixData.length === 0
                ? "(empty)"
                : `0x${Buffer.from(existing.ixData).toString("hex")}`}{" "}
              <span className="text-[var(--color-text-muted)]">
                ({existing.ixData.length} bytes)
              </span>
            </code>
          </Row>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={disabled || busy || submitting}
              onClick={handleClear}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "clearing…" : "Clear"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <Field label="Pick from allowed actions">
            <select
              value={allowedActionKey}
              onChange={(e) => onPickAllowed(e.target.value)}
              disabled={disabled || loadingAllowed}
              className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">— custom (paste below) —</option>
              {allowedActions.map((a) => (
                <option key={a.publicKey.toBase58()} value={a.publicKey.toBase58()}>
                  {truncateAddress(a.targetProgram.toBase58())} · disc{" "}
                  {discriminatorToHex(a.discriminator).slice(0, 8)}…
                </option>
              ))}
            </select>
          </Field>

          <Field label="Target program" error={targetError}>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={disabled || allowedActionKey !== ""}
              placeholder="Base58 program id"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>

          <Field label="Discriminator (16 hex)" error={discError}>
            <input
              type="text"
              value={discHex}
              onChange={(e) => setDiscHex(e.target.value)}
              disabled={disabled || allowedActionKey !== ""}
              placeholder="e.g. b39c4d2a78569f01"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>

          <Field
            label={`ix_data (hex, ≤ ${MAX_AUTO_ACTION_IX_DATA_LEN} bytes)`}
            error={ixDataError}
            hint="Bytes appended after the discriminator to form the inner CPI's data. Empty = discriminator-only."
          >
            <input
              type="text"
              value={ixDataHex}
              onChange={(e) => setIxDataHex(e.target.value)}
              disabled={disabled}
              placeholder="0x… or empty"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm"
            />
          </Field>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canSave}
              onClick={handleSave}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
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
