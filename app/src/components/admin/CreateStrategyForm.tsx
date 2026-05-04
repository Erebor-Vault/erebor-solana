"use client";

import { useState } from "react";
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

const CHECKLIST = [
  { item: "Agent trustworthiness", owner: "Admin/Curator (this checklist)", shipped: false },
  { item: "Agent track record", owner: "Admin/Curator (this checklist)", shipped: false },
  { item: "Agent key security", owner: "Admin/Curator (this checklist)", shipped: false },
  { item: "Choosing allocation weights", owner: "Admin/Curator (set_strategy_weight)", shipped: true },
  { item: "Continuous monitoring", owner: "Admin/Curator (ongoing responsibility)", shipped: false },
  { item: "Token/protocol allowlists", owner: "Admin/Curator (manual review — on-chain enforcement planned)", shipped: false },
  { item: "Velocity limits enforcement", owner: "Admin/Curator (manual monitoring — on-chain limits planned)", shipped: false },
  { item: "Agent access isolation", owner: "Vault (Anchor constraints)", shipped: true },
  { item: "Proportional allocations & rebalancing", owner: "Vault (on-chain)", shipped: true },
  { item: "PDA ownership of all accounts", owner: "Vault (on-chain)", shipped: true },
];

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
  const [showChecklist, setShowChecklist] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetName | "custom">("custom");
  const [kaminoObligation, setKaminoObligation] = useState("");
  const [applyStep, setApplyStep] = useState<{ current: number; total: number } | null>(null);

  const isKaminoPreset = selectedPreset.startsWith("kamino_");

  const handleCreate = async () => {
    try {
      // Validate delegate
      const delegatePubkey = new PublicKey(delegate);

      // Validate kaminoObligation if needed
      let kaminoObligationPk: PublicKey | undefined;
      if (isKaminoPreset) {
        if (!kaminoObligation) {
          throw new Error("Kamino obligation pubkey is required for Kamino presets");
        }
        kaminoObligationPk = new PublicKey(kaminoObligation);
      }

      // Capture strategyId before creating
      const strategyId = vault ? new BN(vault.strategyCount.toNumber()) : new BN(0);

      // Create the strategy
      const sig = await createStrategy(delegatePubkey);
      showTxSuccess(sig);

      // Custom path: done
      if (selectedPreset === "custom") {
        setDelegate("");
        setOpen(false);
        await onCreated();
        return;
      }

      // Build preset context
      if (!wallet.publicKey) throw new Error("Wallet not connected");

      // Derive strategy PDAs
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

      // Fetch mint decimals
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

      // Build preset ixs
      const ixs = await PRESETS_BY_NAME[selectedPreset].buildIxs(ctx);

      // Submit each ix as its own tx
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

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setShowChecklist(!showChecklist)}
          className="rounded-lg bg-[var(--color-surface-hover)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {showChecklist ? "Hide Checklist" : "Safety Checklist"}
        </button>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#12d985]"
          >
            + Create Strategy
          </button>
        )}
      </div>

      {open && (
        <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5 space-y-4">
          <h3 className="font-medium">Create New Strategy</h3>

          <PresetDropdown
            value={selectedPreset}
            onChange={setSelectedPreset}
            disabled={loading || !!applyStep}
          />

          {isKaminoPreset && (
            <div>
              <label className="text-sm text-[var(--color-text-secondary)]">
                Kamino Obligation Pubkey
              </label>
              <input
                value={kaminoObligation}
                onChange={(e) => setKaminoObligation(e.target.value)}
                placeholder="Obligation account pubkey..."
                className="mt-1 w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          )}

          <div>
            <label className="text-sm text-[var(--color-text-secondary)]">
              Delegate Address
            </label>
            <input
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              placeholder="Protocol public key..."
              className="mt-1 w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          {applyStep && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Applying preset… {applyStep.current}/{applyStep.total}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={loading || !!applyStep || !delegate}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading || applyStep
                ? applyStep
                  ? `Applying… ${applyStep.current}/${applyStep.total}`
                  : "Creating..."
                : selectedPreset !== "custom"
                ? "Create + apply preset"
                : "Create"}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={!!applyStep}
              className="rounded-lg bg-[var(--color-surface-hover)] px-4 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showChecklist && <AgentSafetyChecklist />}
    </div>
  );
}

function AgentSafetyChecklist() {
  return (
    <div className="rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border)] p-5 space-y-4">
      <h3 className="font-medium">Agent Safety Checklist</h3>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Review before adding a new agent delegate
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--color-text-muted)]">
            <th className="pb-2 font-medium">Responsibility</th>
            <th className="pb-2 font-medium">Who handles it</th>
            <th className="pb-2 font-medium text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {CHECKLIST.map((row) => (
            <tr key={row.item}>
              <td className="py-2 pr-3">{row.item}</td>
              <td className="py-2 pr-3 text-[var(--color-text-secondary)]">
                {row.owner}
              </td>
              <td className="py-2 text-center">
                {row.shipped ? (
                  <span className="text-[var(--color-success)]" title="Shipped">&#10003;</span>
                ) : (
                  <span className="text-[var(--color-warning)]" title="Planned / Manual">&#9675;</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-3 text-xs text-[var(--color-text-secondary)] space-y-2">
        <p>
          <strong className="text-[var(--color-text-primary)]">Key principle:</strong>{" "}
          The vault cannot cryptographically guarantee agent behavior.
          The vault limits the blast radius (max loss = one strategy&apos;s allocation).
        </p>
        <p>
          The admin/curator is responsible for choosing reliable agents that comply with safety rules.
          This removes the burden of per-agent research from every individual user.
        </p>
      </div>
    </div>
  );
}
