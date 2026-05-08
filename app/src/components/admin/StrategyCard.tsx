"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import { PublicKey, Keypair } from "@solana/web3.js";
import { truncateAddress, formatTokenAmount } from "@/lib/format";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useAllowedActions } from "@/hooks/useAllowedActions";
import { useAutoActionConfigs } from "@/hooks/useAutoActionConfigs";
import { useValueSources } from "@/hooks/useValueSources";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import type { StrategyData } from "@/hooks/useStrategies";
import {
  deriveStrategyTokenPda,
  deriveStrategyAuthorityPda,
} from "@/lib/pda";
import { getCluster } from "@/lib/constants";
import { PRESETS, type PresetName } from "@/lib/strategy-presets/presets";
import type { RowId, StrategySnapshot } from "@/lib/strategy-presets/diff";
import { PresetLabel } from "./strategy/PresetLabel";
import { ChangePresetModal } from "./strategy/ChangePresetModal";

interface Props {
  strategy: StrategyData;
  onRefresh: () => Promise<void>;
}

export function StrategyCard({ strategy, onRefresh }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const program = useVaultProgram();
  const { vault, vaultPda } = useVault();
  const { rebalanceStrategy, reportYield } = useAuthorityActions();
  const { deactivateStrategy, setStrategyWeight } = useAdminActions();
  const [weightInput, setWeightInput] = useState("");
  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [copied, setCopied] = useState<string | null>(null);

  // --- Preset detection ---
  const strategyId = useMemo(() => strategy.strategyId, [strategy.strategyId]);
  const { rows: allowedActionRows } = useAllowedActions(strategy.publicKey);
  const { rows: autoActionRows } = useAutoActionConfigs(strategy.publicKey, strategyId);
  const { rows: valueSourceRows } = useValueSources(strategy.publicKey, strategyId);

  const snapshot = useMemo<StrategySnapshot>(
    () => ({
      allowedActions: allowedActionRows.map((r) => ({
        targetProgram: r.targetProgram,
        discriminator: r.discriminator,
      })),
      autoActions: autoActionRows.map((r) => ({ kind: r.kind as 0 | 1 })),
      valueSources: valueSourceRows.map((r) => ({
        index: r.index,
        kind: r.kind as 0 | 1 | 2,
      })),
    }),
    [allowedActionRows, autoActionRows, valueSourceRows]
  );

  // Build presetRowsByName once per (strategy, vault) — cached in a ref so we
  // don't re-run the async work on every render. Kamino presets need a
  // kaminoObligation pubkey; for *detection only* we pass a synthetic stable
  // pubkey — value-source rows store only { type, index }, NOT the target
  // account, so any pubkey yields the same RowId shape.
  const [presetRowsByName, setPresetRowsByName] = useState<
    Record<PresetName, RowId[]>
  >({
    kamino_liquidity: [],
    kamino_looper: [],
    lulo_lending: [],
    jupiter_swapper: [],
  });

  // Stable synthetic obligation for detection — generated once per card mount.
  const syntheticObligation = useRef(Keypair.generate().publicKey).current;
  const strategyKey = strategy.publicKey.toBase58();

  useEffect(() => {
    if (!vault || !wallet.publicKey) return;

    const strategyIdBn = strategy.strategyId;
    const strategyIdNum = strategyIdBn.toNumber();
    const strategyTokenAccount = deriveStrategyTokenPda(vaultPda, strategyIdNum);
    const strategyAuthority = deriveStrategyAuthorityPda(vaultPda, strategyIdNum);

    const ctx = {
      connection,
      program,
      cluster: getCluster(),
      admin: wallet.publicKey,
      vaultState: vaultPda,
      vault: vaultPda,
      strategyId: strategyIdBn,
      strategy: strategy.publicKey,
      strategyTokenAccount,
      strategyAuthority,
      underlyingDecimals: 6,
      kaminoObligation: syntheticObligation,
    };

    let cancelled = false;
    Promise.all(PRESETS.map((p) => p.buildRows(ctx).catch(() => [] as RowId[]))).then(
      (rowsArr) => {
        if (cancelled) return;
        const byName: Record<PresetName, RowId[]> = {
          kamino_liquidity: [],
          kamino_looper: [],
          lulo_lending: [],
          jupiter_swapper: [],
        };
        PRESETS.forEach((p, i) => {
          byName[p.name] = rowsArr[i];
        });
        setPresetRowsByName(byName);
      }
    );
    return () => { cancelled = true; };
    // Only recompute when the strategy or vault changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyKey, vaultPda.toBase58()]);

  // PresetBuildContext for the ChangePresetModal (uses real wallet pubkey).
  const presetCtx = useMemo(() => {
    if (!wallet.publicKey) return null;
    const strategyIdNum = strategy.strategyId.toNumber();
    return {
      connection,
      program,
      cluster: getCluster(),
      admin: wallet.publicKey,
      vaultState: vaultPda,
      vault: vaultPda,
      strategyId: strategy.strategyId,
      strategy: strategy.publicKey,
      strategyTokenAccount: deriveStrategyTokenPda(vaultPda, strategyIdNum),
      strategyAuthority: deriveStrategyAuthorityPda(vaultPda, strategyIdNum),
      underlyingDecimals: 6,
      kaminoObligation: syntheticObligation,
    };
  }, [wallet.publicKey, vaultPda, strategy.strategyId, strategy.publicKey, connection, program, syntheticObligation]);

  function copyAddress(label: string, address: string) {
    navigator.clipboard.writeText(address);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  const totalDeposited = vault?.totalDeposited.toNumber() || 0;
  const allocationPct =
    totalDeposited > 0
      ? (strategy.allocatedAmount.toNumber() / totalDeposited) * 100
      : 0;

  const targetPct = strategy.targetWeightBps / 100;
  const targetAmount = totalDeposited > 0
    ? Math.floor(totalDeposited * strategy.targetWeightBps / 10000)
    : 0;
  const isAtTarget = strategy.allocatedAmount.toNumber() === targetAmount;

  const unreportedYield = strategy.actualBalance
    .sub(strategy.allocatedAmount)
    .toNumber();

  async function handleAction(action: () => Promise<string | string[]>) {
    setActionLoading(true);
    try {
      const result = await action();
      const sig = Array.isArray(result) ? result[result.length - 1] : result;
      if (sig) showTxSuccess(sig);
      setWeightInput("");
      await onRefresh();
    } catch (err) {
      showTxError(err);
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">#{strategy.strategyId.toString()}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              strategy.isActive
                ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                : "bg-[var(--color-danger)]/20 text-[var(--color-danger)]"
            }`}
          >
            {strategy.isActive ? "Active" : "Inactive"}
          </span>
          {strategy.isActive && (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
              Weight: {targetPct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/vault/${vaultPda.toBase58()}/admin/strategy/${strategy.strategyId.toString()}`}
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            Configure →
          </Link>
          {strategy.isActive && (
            <button
              onClick={() => setShowActions(!showActions)}
              className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
            >
              {showActions ? "Hide" : "Quick actions"}
            </button>
          )}
        </div>
      </div>

      {/* Preset label — always rendered, shows "…" while rows are computed */}
      <div className="mb-3">
        <PresetLabel
          snapshot={snapshot}
          presetRowsByName={presetRowsByName}
          onChangeClick={() => setModalOpen(true)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-[var(--color-text-muted)]">Delegate</span>
          <button
            onClick={() => copyAddress("delegate", strategy.delegate.toBase58())}
            className="flex items-center gap-1 font-mono hover:text-[var(--color-accent)] transition-colors"
            title={strategy.delegate.toBase58()}
          >
            {truncateAddress(strategy.delegate.toBase58())}
            <span className="text-xs">{copied === "delegate" ? "Copied!" : "copy"}</span>
          </button>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Token Account</span>
          <button
            onClick={() => copyAddress("token", strategy.tokenAccount.toBase58())}
            className="flex items-center gap-1 font-mono hover:text-[var(--color-accent)] transition-colors"
            title={strategy.tokenAccount.toBase58()}
          >
            {truncateAddress(strategy.tokenAccount.toBase58())}
            <span className="text-xs">{copied === "token" ? "Copied!" : "copy"}</span>
          </button>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Allocated</span>
          <p>{formatTokenAmount(strategy.allocatedAmount)} USDC ({allocationPct.toFixed(1)}%)</p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Target</span>
          <p>
            {formatTokenAmount(targetAmount)} USDC ({targetPct}%)
            {isAtTarget ? (
              <span className="ml-1 text-[var(--color-success)]">&#10003;</span>
            ) : (
              <span className="ml-1 text-[var(--color-warning)]">&#8800;</span>
            )}
          </p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Actual Balance</span>
          <p>{formatTokenAmount(strategy.actualBalance)} USDC</p>
        </div>
        {unreportedYield > 0 && (
          <div>
            <span className="text-[var(--color-text-muted)]">Unreported Yield</span>
            <p className="text-[var(--color-success)]">
              +{formatTokenAmount(unreportedYield)} USDC
            </p>
          </div>
        )}
      </div>

      {/* Report Yield — always visible when there's unreported yield */}
      {strategy.isActive && unreportedYield > 0 && (
        <div className="mt-3">
          <button
            onClick={() =>
              handleAction(() =>
                reportYield(strategy.strategyId.toNumber(), strategy.tokenAccount)
              )
            }
            disabled={actionLoading}
            className="w-full rounded-lg bg-[var(--color-success)]/20 px-4 py-2 text-sm font-medium text-[var(--color-success)] disabled:opacity-50"
          >
            Report Yield (+{formatTokenAmount(unreportedYield)} USDC)
          </button>
        </div>
      )}

      {showActions && strategy.isActive && (
        <div className="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4">
          {/* Set Weight */}
          <div className="flex gap-2">
            <input
              type="number"
              value={weightInput}
              onChange={(e) => setWeightInput(e.target.value)}
              placeholder="Weight % (e.g. 50)"
              min="0"
              max="100"
              step="0.01"
              className="flex-1 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => {
                const pct = parseFloat(weightInput);
                if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                  const bps = Math.round(pct * 100);
                  handleAction(() =>
                    setStrategyWeight(strategy.strategyId.toNumber(), bps)
                  );
                }
              }}
              disabled={actionLoading || !weightInput}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              Set Weight
            </button>
          </div>

          {/* Rebalance */}
          {!isAtTarget && (
            <button
              onClick={() =>
                handleAction(() =>
                  rebalanceStrategy(
                    strategy.strategyId.toNumber(),
                    strategy.tokenAccount
                  )
                )
              }
              disabled={actionLoading}
              className="w-full rounded-lg bg-[var(--color-accent)]/20 px-4 py-2 text-sm font-medium text-[var(--color-accent)] disabled:opacity-50"
            >
              Rebalance to Target ({formatTokenAmount(targetAmount)} USDC)
            </button>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                if (confirm("Deactivate this strategy permanently?"))
                  handleAction(() =>
                    deactivateStrategy(
                      strategy.strategyId.toNumber(),
                      strategy.tokenAccount
                    )
                  );
              }}
              disabled={actionLoading}
              className="rounded-lg bg-[var(--color-danger)]/20 px-4 py-2 text-sm font-medium text-[var(--color-danger)] disabled:opacity-50"
            >
              Deactivate
            </button>
          </div>
        </div>
      )}

      {/* Change-preset modal */}
      {presetCtx && (
        <ChangePresetModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          ctx={presetCtx}
          snapshot={snapshot}
          onApplied={onRefresh}
        />
      )}
    </div>
  );
}
