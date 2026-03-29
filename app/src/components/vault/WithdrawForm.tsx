"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWithdraw } from "@/hooks/useWithdraw";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useVault } from "@/components/providers/VaultProvider";
import { useStrategies } from "@/hooks/useStrategies";
import { useAuthorityActions } from "@/hooks/useAuthorityActions";
import { AmountInput } from "@/components/shared/AmountInput";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { parseTokenInput, formatTokenAmount } from "@/lib/format";

export function WithdrawForm() {
  const { connected } = useWallet();
  const { withdraw, loading } = useWithdraw();
  const { sharePrice, reserveBalance, vault } = useVault();
  const { shareBalance, refresh: refreshPosition } = useUserPosition();
  const { strategies } = useStrategies();
  const { rebalanceAll } = useAuthorityActions();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");

  const parsedShares = parseTokenInput(amount);
  const estimatedTokens = parsedShares
    ? parsedShares.toNumber() * sharePrice
    : 0;

  const reserveInsufficient =
    estimatedTokens > 0 && estimatedTokens > reserveBalance.toNumber();

  const handleWithdraw = async () => {
    if (!parsedShares) return;
    try {
      setStatus("Withdrawing...");
      const sig = await withdraw(parsedShares);
      showTxSuccess(sig);
      setAmount("");

      // Auto-rebalance all active strategies after withdrawal
      if (vault) {
        const activeStrategies = strategies.filter(
          (s) => s.isActive && s.targetWeightBps > 0
        );
        if (activeStrategies.length > 0) {
          setStatus("Rebalancing strategies...");
          const sigs = await rebalanceAll(
            activeStrategies.map((s) => ({
              strategyId: s.strategyId.toNumber(),
              tokenAccount: s.tokenAccount,
              allocatedAmount: s.allocatedAmount,
              targetWeightBps: s.targetWeightBps,
            })),
            vault.totalDeposited.toNumber() - estimatedTokens
          );
          if (sigs.length > 0) showTxSuccess(sigs[sigs.length - 1]);
        }
      }

      setStatus("");
      await refreshPosition();
    } catch (err) {
      setStatus("");
      showTxError(err);
    }
  };

  return (
    <div className="space-y-4">
      <AmountInput
        value={amount}
        onChange={setAmount}
        maxAmount={shareBalance.toNumber()}
        label="Shares to Burn"
        symbol="Shares"
        disabled={!connected || loading}
      />

      {parsedShares && (
        <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
          <span>You will receive</span>
          <span>~{formatTokenAmount(estimatedTokens)} USDC</span>
        </div>
      )}

      {reserveInsufficient && (
        <p className="text-sm text-[var(--color-warning)]">
          Insufficient reserve — backend will rebalance strategies to free funds
        </p>
      )}

      <button
        onClick={handleWithdraw}
        disabled={
          !connected || !parsedShares || loading || reserveInsufficient
        }
        className="w-full rounded-lg bg-[var(--color-accent-secondary)] py-3 font-semibold text-white transition-colors hover:bg-[#8035ee] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status || (loading ? "Withdrawing..." : connected ? "Withdraw" : "Connect Wallet")}
      </button>
    </div>
  );
}
