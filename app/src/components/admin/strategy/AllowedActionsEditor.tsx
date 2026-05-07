"use client";

import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import type { StrategyData } from "@/hooks/useStrategies";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAllowedActions, type AllowedActionRow } from "@/hooks/useAllowedActions";
import {
  ACTION_PRESETS,
  groupPresets,
  discriminatorToHex,
  hexToDiscriminator,
  anchorDiscriminator,
  type ActionPreset,
} from "@/lib/actionPresets";
import { CopyButton } from "@/components/shared/CopyButton";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { truncateAddress } from "@/lib/format";
import { lookupRegistryActionLabel } from "@/lib/strategy-presets/lookupActionLabel";
import { clusterOrThrow } from "@/lib/strategy-presets/registry";

interface Props {
  strategy: StrategyData;
  disabled?: boolean;
}

/**
 * Real allowed-action whitelist editor.
 *
 * Wires into `program.addAllowedAction` / `program.removeAllowedAction`
 * via {@link useAdminActions}. Lists existing entries (with remove buttons)
 * via {@link useAllowedActions}. Quick-pick presets come from
 * {@link ACTION_PRESETS}.
 */
export function AllowedActionsEditor({ strategy, disabled }: Props) {
  const { addAllowedAction, removeAllowedAction, loading: writing } = useAdminActions();
  const { rows, loading: reading, refresh } = useAllowedActions(strategy.publicKey);

  const [presetKey, setPresetKey] = useState<string>(""); // "" = custom
  const [target, setTarget] = useState("");
  const [discHex, setDiscHex] = useState("");
  const [methodName, setMethodName] = useState("");
  const [recipientIdx, setRecipientIdx] = useState("");
  const [outputMintIdx, setOutputMintIdx] = useState("");
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => groupPresets(), []);

  // Parsed inputs.
  let targetParsed: PublicKey | null = null;
  let targetError: string | null = null;
  if (target.trim() !== "") {
    try {
      targetParsed = new PublicKey(target.trim());
    } catch {
      targetError = "Not a valid base58 program id";
    }
  }
  const discBytes = discHex.trim() === "" ? null : hexToDiscriminator(discHex.trim());
  const discError = discHex.trim() !== "" && discBytes === null ? "Need 8 bytes (16 hex chars)" : null;

  let recipientIdxParsed: number | null = null;
  let recipientIdxError: string | null = null;
  if (recipientIdx.trim() === "") {
    recipientIdxError = "Required — pin the strategy ATA's slot in the relayed ix";
  } else {
    const n = Number(recipientIdx.trim());
    if (!Number.isInteger(n) || n < 0 || n > 65_534) {
      recipientIdxError = "Must be 0..65534";
    } else {
      recipientIdxParsed = n;
    }
  }

  // outputMintIdx is optional. When set, the program checks that the mint
  // at that slot in remaining_accounts is on the protocol token allow-list.
  let outputMintIdxParsed: number | null = null;
  let outputMintIdxError: string | null = null;
  if (outputMintIdx.trim() !== "") {
    const n = Number(outputMintIdx.trim());
    if (!Number.isInteger(n) || n < 0 || n > 65_534) {
      outputMintIdxError = "Must be 0..65534 or empty";
    } else {
      outputMintIdxParsed = n;
    }
  }

  // Match each preset against the current whitelist so the dropdown can flag
  // already-defined entries (case-insensitive program id + byte-equal disc).
  const presetStatus = useMemo(() => {
    const m = new Map<string, AllowedActionRow | null>();
    for (const p of ACTION_PRESETS) {
      const found =
        rows.find(
          (r) =>
            r.targetProgram.equals(p.targetProgram) &&
            r.discriminator.length === p.discriminator.length &&
            r.discriminator.every((b, i) => b === p.discriminator[i])
        ) ?? null;
      m.set(p.label, found);
    }
    return m;
  }, [rows]);

  function applyPreset(label: string) {
    setPresetKey(label);
    if (!label) return;
    const p = ACTION_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setTarget(p.targetProgram.toBase58());
    setDiscHex(discriminatorToHex(p.discriminator));
    setMethodName(p.method);
    setRecipientIdx(
      p.expectedRecipientIndex !== undefined ? String(p.expectedRecipientIndex) : ""
    );
    setOutputMintIdx(
      p.expectedOutputMintIndex !== undefined ? String(p.expectedOutputMintIndex) : ""
    );
  }

  async function deriveDiscFromMethod() {
    if (!methodName.trim()) return;
    const d = await anchorDiscriminator(methodName.trim());
    if (d) setDiscHex(discriminatorToHex(d));
  }

  const canSubmit =
    !disabled &&
    !writing &&
    !busy &&
    targetParsed !== null &&
    discBytes !== null &&
    recipientIdxParsed !== null &&
    outputMintIdxError === null;

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !targetParsed || !discBytes || recipientIdxParsed === null) return;
    setBusy(true);
    try {
      const sig = await addAllowedAction(
        strategy.strategyId.toNumber(),
        targetParsed,
        discBytes,
        recipientIdxParsed,
        outputMintIdxParsed,
      );
      showTxSuccess(sig);
      // Reset only the fields the admin most likely wants to vary; keep target.
      setDiscHex("");
      setMethodName("");
      setRecipientIdx("");
      setOutputMintIdx("");
      setPresetKey("");
      await refresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(row: AllowedActionRow) {
    setBusy(true);
    try {
      const sig = await removeAllowedAction(
        strategy.strategyId.toNumber(),
        row.targetProgram,
        row.discriminator
      );
      showTxSuccess(sig);
      await refresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-6">
      <header className="mb-3">
        <h3 className="text-base font-semibold">
          Allowed actions — strategy {strategy.strategyId.toString()}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Whitelist <code>(target_program, discriminator)</code> pairs the
          delegate is allowed to invoke through <code>execute_action</code>.
          The recipient-index pin (required) enforces that the relayed
          instruction&apos;s <code>accounts[index]</code> is the strategy ATA.
        </p>
      </header>
      <div className="mb-4 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
        ⚠ <strong>Liveness pairing:</strong> if you whitelist a deposit /
        lend / supply discriminator on a protocol, also whitelist the
        matching withdraw / redeem so the authority can always pull funds
        back through the same path. Otherwise an external position can be
        stranded if the protocol disables the agent&apos;s direct delegate.
      </div>

      <form onSubmit={onAdd} className="grid gap-4">
        <Field label="Preset">
          <select
            disabled={disabled}
            value={presetKey}
            onChange={(e) => applyPreset(e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          >
            <option value="">Custom action…</option>
            {Array.from(grouped.entries()).map(([protocol, list]) => (
              <optgroup key={protocol} label={protocol}>
                {list.map((p) => {
                  const exists = presetStatus.get(p.label);
                  return (
                    <option key={p.label} value={p.label}>
                      {exists ? "✓ " : ""}
                      {p.label}
                      {exists ? " (already whitelisted)" : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          {presetKey && presetStatus.get(presetKey) ? (
            <p className="text-xs text-[var(--color-warning)]">
              This preset is already whitelisted on this strategy.
            </p>
          ) : null}
        </Field>

        <Field label="Target program">
          <input
            type="text"
            disabled={disabled}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Base58 program id…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!targetError}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          {targetError ? (
            <p className="text-xs text-[var(--color-danger)]">{targetError}</p>
          ) : null}
        </Field>

        <Field label="Instruction discriminator (8 bytes hex)">
          <div className="flex gap-2">
            <input
              type="text"
              disabled={disabled}
              value={discHex}
              onChange={(e) => setDiscHex(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!!discError}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
            />
          </div>
          {discError ? (
            <p className="text-xs text-[var(--color-danger)]">{discError}</p>
          ) : null}
          <p className="text-xs text-[var(--color-text-muted)]">
            For Anchor programs: <code>sha256(&quot;global:&lt;method&gt;&quot;)[..8]</code>.
            Type a method name below to compute it.
          </p>
        </Field>

        <Field label="Anchor method name (optional helper)">
          <div className="flex gap-2">
            <input
              type="text"
              disabled={disabled}
              value={methodName}
              onChange={(e) => setMethodName(e.target.value)}
              placeholder="e.g. lending_account_deposit"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={deriveDiscFromMethod}
              disabled={disabled || !methodName.trim()}
              className="rounded-md border border-[var(--color-border)] px-3 text-xs font-medium hover:border-[var(--color-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Compute
            </button>
          </div>
        </Field>

        <Field label="Expected recipient account index (required)">
          <input
            type="text"
            disabled={disabled}
            value={recipientIdx}
            onChange={(e) => setRecipientIdx(e.target.value)}
            placeholder="0..65534"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!recipientIdxError}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          {recipientIdxError ? (
            <p className="text-xs text-[var(--color-danger)]">{recipientIdxError}</p>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              The relayed instruction&apos;s <code>accounts[index]</code> must
              equal this strategy&apos;s token account, enforced on-chain.
            </p>
          )}
        </Field>

        <Field label="Output mint account index (optional, Phase-4d)">
          <input
            type="text"
            disabled={disabled}
            value={outputMintIdx}
            onChange={(e) => setOutputMintIdx(e.target.value)}
            placeholder="leave blank for non-swap actions; e.g. 4 for Jupiter v6 route"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!outputMintIdxError}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          {outputMintIdxError ? (
            <p className="text-xs text-[var(--color-danger)]">{outputMintIdxError}</p>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)]">
              When set, the mint at <code>accounts[index]</code> must be on
              the protocol token allow-list — required for any swap-style
              action so a compromised agent can&apos;t route into a
              non-allowed asset.
            </p>
          )}
        </Field>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy || writing ? "Adding…" : "Add allowed action"}
        </button>
      </form>

      <div className="mt-6">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Whitelisted actions ({rows.length})
        </p>
        {reading ? (
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="mt-2 rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            No whitelist entries on this strategy yet. The delegate cannot
            call <code>execute_action</code> until the admin adds at least one.
          </div>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {rows.map((r) => {
              const matchedPreset = ACTION_PRESETS.find(
                (p) =>
                  p.targetProgram.equals(r.targetProgram) &&
                  p.discriminator.length === r.discriminator.length &&
                  p.discriminator.every((b, i) => b === r.discriminator[i])
              );
              const cluster = clusterOrThrow(
                (process.env.NEXT_PUBLIC_CLUSTER ?? "devnet") as Parameters<typeof clusterOrThrow>[0]
              );
              const registryLabel = lookupRegistryActionLabel(cluster, r.targetProgram, r.discriminator);
              const displayLabel = matchedPreset?.label ?? registryLabel ?? "Custom action";
              return (
                <li
                  key={r.publicKey.toBase58()}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {displayLabel}
                      </span>
                      <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                        recipient idx {r.expectedRecipientIndex}
                      </span>
                      {r.outputMintIndex != null ? (
                        <span className="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs text-[var(--color-accent)]">
                          output mint idx {r.outputMintIndex}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-[var(--color-text-muted)]">
                      <span title={r.targetProgram.toBase58()}>
                        target {truncateAddress(r.targetProgram.toBase58(), 6)}
                      </span>
                      <CopyButton
                        value={r.targetProgram.toBase58()}
                        ariaLabel="Copy target program id"
                      />
                      <span className="ml-2">
                        disc {discriminatorToHex(r.discriminator)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(r)}
                    disabled={disabled || busy || writing}
                    className="rounded-md bg-[var(--color-danger)]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}
