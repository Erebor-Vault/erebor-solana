"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDeposit } from "@/hooks/useDeposit";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useVault } from "@/components/providers/VaultProvider";
import { AmountInput } from "@/components/shared/AmountInput";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";
import { parseTokenInput, formatTokenAmount } from "@/lib/format";

export function DepositForm() {
  const { connected } = useWallet();
  const { deposit, loading } = useDeposit();
  const { sharePrice } = useVault();
  const { tokenBalance, refresh: refreshPosition } = useUserPosition();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");

  const parsedAmount = parseTokenInput(amount);
  const estimatedShares = parsedAmount
    ? parsedAmount.toNumber() / sharePrice
    : 0;

  const handleDeposit = async () => {
    if (!parsedAmount) return;
    try {
      setStatus("Depositing...");
      const sig = await deposit(parsedAmount);
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
        maxAmount={tokenBalance.toNumber()}
        label="Deposit Amount"
        symbol="USDC"
        disabled={!connected || loading}
      />

      {parsedAmount && (
        <div className="flex justify-between text-sm text-[var(--color-text-secondary)]">
          <span>You will receive</span>
          <span>~{formatTokenAmount(estimatedShares)} shares</span>
        </div>
      )}

      <button
        onClick={handleDeposit}
        disabled={!connected || !parsedAmount || loading}
        className="w-full rounded-lg bg-[var(--color-accent)] py-3 font-semibold text-black transition-colors hover:bg-[#12d985] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status || (loading ? "Depositing..." : connected ? "Deposit" : "Connect Wallet")}
      </button>
    </div>
  );
}
