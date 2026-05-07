"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWithdraw } from "@/hooks/useWithdraw";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useVault } from "@/components/providers/VaultProvider";
import { AmountInput } from "@/components/shared/AmountInput";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { parseTokenInput, formatTokenAmount } from "@/lib/format";

export function WithdrawForm() {
  const { connected } = useWallet();
  const { withdraw, loading } = useWithdraw();
  const { sharePrice, reserveBalance, vault } = useVault();
  const { shareBalance, refresh: refreshPosition } = useUserPosition();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");

  const parsedShares = parseTokenInput(amount, 12);
  const grossTokens = parsedShares
    ? parsedShares.toNumber() * sharePrice
    : 0;
  const feeBps = vault?.performanceFeeBps ?? 0;
  const feeTokens = Math.floor((grossTokens * feeBps) / 10_000);
  const estimatedTokens = grossTokens - feeTokens;

  const reserveInsufficient =
    grossTokens > 0 && grossTokens > reserveBalance.toNumber();

  const handleWithdraw = async () => {
    if (!parsedShares) return;
    try {
      setStatus("Withdrawing...");
      const sig = await withdraw(parsedShares);
      showTxSuccess(sig);
      setAmount("");
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
        decimals={12}
        label="Shares to Burn"
        symbol="Shares"
        disabled={!connected || loading}
      />

      {parsedShares && (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <span>Gross redemption</span>
            <span className="tabular-nums">~{formatTokenAmount(grossTokens)} USDC</span>
          </div>
          {feeBps > 0 && (
            <div className="flex justify-between text-[var(--color-text-muted)]">
              <span>
                Performance fee ({(feeBps / 100).toFixed(2)}%)
              </span>
              <span className="tabular-nums">−{formatTokenAmount(feeTokens)} USDC</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--color-border)] pt-1 font-medium">
            <span>You will receive</span>
            <span className="tabular-nums">~{formatTokenAmount(estimatedTokens)} USDC</span>
          </div>
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
