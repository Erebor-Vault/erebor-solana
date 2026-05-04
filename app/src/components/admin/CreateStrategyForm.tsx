"use client";

import { useEffect, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getMint } from "@solana/spl-token";
import BN from "bn.js";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useVault } from "@/components/providers/VaultProvider";
import { useVaultProgram } from "@/hooks/useVaultProgram";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { PresetDropdown } from "@/components/admin/PresetDropdown";
import {
  PRESETS_BY_NAME,
  type PresetName,
  type PresetBuildContext,
} from "@/lib/strategy-presets/presets";
import { clusterOrThrow } from "@/lib/strategy-presets/registry";
import type { Cluster } from "@solana/web3.js";

interface Props {
  onCreated: () => Promise<void>;
}

export function CreateStrategyForm({ onCreated }: Props) {
  const { createStrategy, loading } = useAdminActions();
  const { vaultPda, tokenMint, vault } = useVault();
  const program = useVaultProgram();
  const wallet = useWallet();
  const { connection } = useConnection();

  const [delegate, setDelegate] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetName | "custom">("custom");
  const [kaminoObligation, setKaminoObligation] = useState("");
  const [applyStep, setApplyStep] = useState<{ current: number; total: number } | null>(null);

  const isKaminoPreset = selectedPreset.startsWith("kamino_");
  const busy = loading || !!applyStep;
  const canSubmit =
    !busy && delegate.trim().length > 0 && (!isKaminoPreset || kaminoObligation.trim().length > 0);

  // Lock background scroll while modal open + close on Escape.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applyStep) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, applyStep]);

  const handleCreate = async () => {
    try {
      const delegatePubkey = new PublicKey(delegate);

      let kaminoObligationPk: PublicKey | undefined;
      if (isKaminoPreset) {
        if (!kaminoObligation) {
          throw new Error("Kamino obligation pubkey is required for Kamino presets");
        }
        kaminoObligationPk = new PublicKey(kaminoObligation);
      }

      const strategyId = vault ? new BN(vault.strategyCount.toNumber()) : new BN(0);

      const sig = await createStrategy(delegatePubkey);
      showTxSuccess(sig);

      if (selectedPreset === "custom") {
        setDelegate("");
        setOpen(false);
        await onCreated();
        return;
      }

      if (!wallet.publicKey) throw new Error("Wallet not connected");

      const [strategy] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy"), vaultPda.toBuffer(), strategyId.toArrayLike(Buffer, "le", 8)],
        program.programId,
      );
      const [strategyTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_token"), vaultPda.toBuffer(), strategyId.toArrayLike(Buffer, "le", 8)],
        program.programId,
      );
      const [strategyAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("strategy_authority"), vaultPda.toBuffer(), strategyId.toArrayLike(Buffer, "le", 8)],
        program.programId,
      );

      const mintInfo = await getMint(connection, tokenMint);
      const clusterStr = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
      const cluster = clusterOrThrow(clusterStr as Cluster);

      const ctx: PresetBuildContext = {
        connection,
        program: program as any,
        cluster,
        admin: wallet.publicKey,
        vaultState: vaultPda,
        vault: vaultPda,
        strategyId,
        strategy,
        strategyTokenAccount,
        strategyAuthority,
        underlyingDecimals: mintInfo.decimals,
        kaminoObligation: kaminoObligationPk,
      };

      const ixs = await PRESETS_BY_NAME[selectedPreset].buildIxs(ctx);

      setApplyStep({ current: 0, total: ixs.length });
      for (let i = 0; i < ixs.length; i++) {
        setApplyStep({ current: i + 1, total: ixs.length });
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const tx = new Transaction();
        tx.feePayer = wallet.publicKey;
        tx.recentBlockhash = blockhash;
        tx.add(ixs[i]);
        if (!wallet.sendTransaction) {
          throw new Error("Wallet does not support sendTransaction");
        }
        const txSig = await wallet.sendTransaction(tx, connection);
        await connection.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight });
      }

      setApplyStep(null);
      setDelegate("");
      setKaminoObligation("");
      setOpen(false);
      await onCreated();
    } catch (err) {
      setApplyStep(null);
      showTxError(err);
    }
  };

  const progressPct = applyStep ? (applyStep.current / applyStep.total) * 100 : 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-[var(--color-accent-glow)] hover:shadow-[0_0_20px_-4px_rgba(127,240,214,0.5)]"
      >
        <HexMark />
        Create Strategy
      </button>

      {open && (
        <Modal onClose={() => !applyStep && setOpen(false)}>
          {/* corner runes */}
          <CornerRune className="absolute left-3 top-3" />
          <CornerRune className="absolute right-3 top-3 rotate-90" />
          <CornerRune className="absolute left-3 bottom-3 -rotate-90" />
          <CornerRune className="absolute right-3 bottom-3 rotate-180" />

          <div className="relative px-7 pt-7 pb-2">
            <div className="eyebrow flex items-center gap-2">
              <span aria-hidden>·</span>
              <span>Strategy</span>
              <span aria-hidden>·</span>
            </div>
            <h3 className="font-display mt-1 text-2xl tracking-tight">Create Strategy</h3>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              Inscribe an allocation slot into the vault. A preset writes the
              allowed-action whitelist, auto-action configs, and value sources
              in one bundle.
            </p>
          </div>

          <Divider />

          <Section index="I" title="Choose a preset" busy={busy}>
            <PresetDropdown
              value={selectedPreset}
              onChange={setSelectedPreset}
              disabled={busy}
            />
          </Section>

          <Section index="II" title="Configure" busy={busy}>
            <Field label="Delegate address" required>
              <input
                value={delegate}
                onChange={(e) => setDelegate(e.target.value)}
                placeholder="Agent / protocol pubkey"
                disabled={busy}
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_rgba(94,234,212,0.12)] disabled:opacity-50"
                autoComplete="off"
                spellCheck={false}
              />
              <Hint>
                The wallet allowed to call <code className="font-mono">execute_action</code> on
                this strategy.
              </Hint>
            </Field>

            {isKaminoPreset && (
              <Field label="Kamino obligation pubkey" required>
                <input
                  value={kaminoObligation}
                  onChange={(e) => setKaminoObligation(e.target.value)}
                  placeholder="Obligation account"
                  disabled={busy}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_rgba(94,234,212,0.12)] disabled:opacity-50"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Hint>
                  The Kamino position whose deposited cToken amount feeds this
                  strategy&rsquo;s NAV value source.
                </Hint>
              </Field>
            )}
          </Section>

          <Divider />

          <div className="px-7 py-5">
            <div className="flex items-center gap-3">
              <StepIndex>III</StepIndex>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">Submit</span>
              {applyStep && (
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent-secondary)]">
                  inscribing {applyStep.current} / {applyStep.total}
                </span>
              )}
            </div>

            {applyStep && (
              <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
                <div
                  className="h-full bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
                  style={{
                    width: `${progressPct}%`,
                    boxShadow: "0 0 12px rgba(127,240,214,0.6)",
                  }}
                />
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={!!applyStep}
                className="text-xs text-[var(--color-text-muted)] underline-offset-4 transition hover:text-[var(--color-text-secondary)] hover:underline disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[var(--color-accent-glow)] hover:shadow-[0_0_24px_-4px_rgba(127,240,214,0.6)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--color-accent)] disabled:hover:shadow-none"
              >
                <HexMark />
                {applyStep
                  ? `Applying ${applyStep.current} / ${applyStep.total}`
                  : loading
                  ? "Creating…"
                  : selectedPreset !== "custom"
                  ? "Create Strategy + apply preset"
                  : "Create Strategy"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* sub-components                                                      */
/* ──────────────────────────────────────────────────────────────────── */

function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 px-4 py-10 backdrop-blur-[2px]"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(94,234,212,0.04)_0%,rgba(8,17,26,0)_55%),var(--color-surface-secondary)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),0_0_0_1px_rgba(94,234,212,0.04)]"
      >
        {children}
      </div>
    </div>
  );
}

function Section({
  index,
  title,
  busy,
  children,
}: {
  index: string;
  title: string;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`px-7 py-5 transition-opacity ${busy ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <StepIndex>{index}</StepIndex>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{title}</span>
      </div>
      <div className="mt-3 ml-9 space-y-4">{children}</div>
    </div>
  );
}

function StepIndex({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center font-display text-sm leading-none text-[var(--color-accent-secondary)]"
      aria-hidden
    >
      {children}
    </span>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
          {label}
        </label>
        {required && (
          <span className="text-[10px] text-[var(--color-accent-secondary)]" aria-hidden>
            *
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{children}</p>;
}

function Divider() {
  return (
    <div
      className="mx-7 h-px"
      style={{
        background:
          "linear-gradient(90deg, transparent 0%, rgba(212,162,74,0.25) 50%, transparent 100%)",
      }}
    />
  );
}

function HexMark() {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" fill="none" aria-hidden className="opacity-90">
      <path
        d="M5 0.5 L9.5 3 L9.5 8 L5 10.5 L0.5 8 L0.5 3 Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}

function CornerRune({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className={className}>
      <path
        d="M0 0 L6 0 M0 0 L0 6"
        stroke="currentColor"
        strokeWidth="1"
        className="text-[var(--color-border-strong)]"
      />
    </svg>
  );
}
