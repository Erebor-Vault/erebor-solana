"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction, PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { PresetDropdown } from "../PresetDropdown";
import {
  PRESETS_BY_NAME,
  type PresetName,
  type PresetBuildContext,
} from "@/lib/strategy-presets/presets";
import {
  diffRowSets,
  snapshotToRows,
  type RowId,
  type StrategySnapshot,
} from "@/lib/strategy-presets/diff";
import { showTxError } from "@/components/shared/TxToast";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAutoActionConfigs } from "@/hooks/useAutoActionConfigs";
import { useValueSources } from "@/hooks/useValueSources";

interface Props {
  open: boolean;
  onClose: () => void;
  ctx: PresetBuildContext;
  snapshot: StrategySnapshot;
  onApplied: () => Promise<void>;
}

export function ChangePresetModal({
  open,
  onClose,
  ctx,
  snapshot,
  onApplied,
}: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { removeAllowedAction } = useAdminActions();
  // clearAutoActionConfig and removeValueSource require strategy + strategyId
  const { clearConfig: clearAutoActionConfig } = useAutoActionConfigs(
    ctx.strategy,
    ctx.strategyId
  );
  const { removeSource: removeValueSource } = useValueSources(
    ctx.strategy,
    ctx.strategyId
  );

  const [target, setTarget] = useState<PresetName | "custom">("custom");
  const [targetRows, setTargetRows] = useState<RowId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (target === "custom") {
      setTargetRows([]);
      return;
    }
    PRESETS_BY_NAME[target].buildRows(ctx).then(setTargetRows).catch(() => {
      setTargetRows([]);
    });
  }, [target, ctx]);

  const currentRows = useMemo(() => snapshotToRows(snapshot), [snapshot]);
  const { toRevoke, toAdd } = useMemo(
    () => diffRowSets(currentRows, targetRows),
    [currentRows, targetRows]
  );

  if (!open) return null;

  async function handleApply() {
    if (!wallet.publicKey || !wallet.sendTransaction) {
      showTxError(new Error("Wallet not connected"));
      return;
    }

    setSubmitting(true);
    setProgress(null);

    const strategyIdNum = ctx.strategyId.toNumber();
    const total = toRevoke.length + toAdd.length;
    let done = 0;

    try {
      // ---- Revoke phase ----
      for (const row of toRevoke) {
        done++;
        setProgress(`Step ${done}/${total} — revoking…`);
        if (row.type === "allowed_action") {
          const disc = Array.from(Buffer.from(row.discriminator, "hex"));
          await removeAllowedAction(
            strategyIdNum,
            new PublicKey(row.targetProgram),
            disc
          );
        } else if (row.type === "auto_action") {
          await clearAutoActionConfig(row.kind);
        } else if (row.type === "value_source") {
          await removeValueSource(row.index);
        }
      }

      // ---- Add phase ----
      // Build the full target preset ix list, then submit only the ixs whose
      // corresponding row is in toAdd (matched by parallel index walk).
      if (toAdd.length > 0 && target !== "custom") {
        const [targetIxs, builtTargetRows] = await Promise.all([
          PRESETS_BY_NAME[target].buildIxs(ctx),
          PRESETS_BY_NAME[target].buildRows(ctx),
        ]);

        const toAddSet = new Set(toAdd.map((r) => JSON.stringify(r)));

        for (let i = 0; i < builtTargetRows.length; i++) {
          const rowKey = JSON.stringify(builtTargetRows[i]);
          if (!toAddSet.has(rowKey)) continue;

          done++;
          setProgress(`Step ${done}/${total} — adding…`);

          const ix = targetIxs[i];
          const tx = new Transaction().add(ix);
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = wallet.publicKey;
          const sig = await wallet.sendTransaction(tx, connection);
          await connection.confirmTransaction(
            { signature: sig, blockhash, lastValidBlockHeight },
            "confirmed"
          );
        }
      }

      await onApplied();
      onClose();
    } catch (err) {
      showTxError(err);
      setProgress(
        `Applied ${done - 1} of ${total}; you can retry via "Change preset…".`
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-2xl rounded-lg bg-[var(--color-surface)] p-6 space-y-4">
        <h2 className="text-lg font-semibold">Change preset</h2>

        <PresetDropdown
          value={target}
          onChange={setTarget}
          disabled={submitting}
        />

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <h3 className="font-medium text-red-400 mb-1">
              Will revoke ({toRevoke.length})
            </h3>
            <ul className="space-y-1">
              {toRevoke.map((r, i) => (
                <li key={i} className="text-[var(--color-text-secondary)]">
                  {rowLabel(r)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-green-400 mb-1">
              Will add ({toAdd.length})
            </h3>
            <ul className="space-y-1">
              {toAdd.map((r, i) => (
                <li key={i} className="text-[var(--color-text-secondary)]">
                  {rowLabel(r)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {progress && (
          <p className="text-xs text-[var(--color-text-secondary)]">{progress}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={
              submitting || (toRevoke.length === 0 && toAdd.length === 0)
            }
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {submitting ? "Applying…" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function rowLabel(r: RowId): string {
  if (r.type === "allowed_action")
    return `Allowed action: ${r.targetProgram.slice(0, 4)}…  disc=${r.discriminator.slice(0, 8)}`;
  if (r.type === "auto_action")
    return `Auto-action: kind=${r.kind === 0 ? "Deposit" : "Withdraw"}`;
  return `Value source #${r.index}`;
}
