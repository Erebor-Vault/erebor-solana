"use client";

import { useState } from "react";
import BN from "bn.js";
import { useWallet } from "@solana/wallet-adapter-react";
import type { StrategyData } from "@/hooks/useStrategies";
import { useVault } from "@/components/providers/VaultProvider";
import { useAdminActions } from "@/hooks/useAdminActions";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

interface Props {
  strategy: StrategyData;
  decimals: number;
}

/** Authority-only realised-loss reporting (audit #6). Subtracts from both
 *  `strategy.allocated_amount` and `vault_state.total_deposited`. */
export function ReportLossButton({ strategy, decimals }: Props) {
  const { vault } = useVault();
  const wallet = useWallet();
  const { reportLoss, loading } = useAdminActions();
  const [open, setOpen] = useState(false);
  const [amountInput, setAmountInput] = useState("");

  const isAuthority =
    !!wallet.publicKey && !!vault && wallet.publicKey.equals(vault.authority);

  if (!isAuthority) return null;

  async function onSubmit() {
    const n = Number(amountInput.trim());
    if (!Number.isFinite(n) || n <= 0) {
      showTxError(new Error("Loss amount must be > 0"));
      return;
    }
    const raw = new BN(Math.round(n * Math.pow(10, decimals)));
    try {
      const sig = await reportLoss(strategy.strategyId.toNumber(), raw);
      showTxSuccess(sig);
      setOpen(false);
      setAmountInput("");
    } catch (err) {
      showTxError(err);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--color-danger)]/15 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25"
      >
        Report loss…
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2">
      <input
        type="number"
        step="any"
        value={amountInput}
        onChange={(e) => setAmountInput(e.target.value)}
        placeholder="Loss amount"
        className="w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
      />
      <button
        onClick={onSubmit}
        disabled={loading}
        className="rounded-md bg-[var(--color-danger)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        Confirm
      </button>
      <button
        onClick={() => setOpen(false)}
        className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs"
      >
        Cancel
      </button>
    </div>
  );
}
