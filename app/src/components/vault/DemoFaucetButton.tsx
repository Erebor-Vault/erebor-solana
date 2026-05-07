"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDemoFaucet } from "@/hooks/useDemoFaucet";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useVault } from "@/components/providers/VaultProvider";
import { showTxSuccess, showTxError } from "@/components/shared/TxToast";

export function DemoFaucetButton() {
  const { connected } = useWallet();
  const { activeEntry, tokenMint } = useVault();
  const { refresh } = useUserPosition();
  const { claim, busy } = useDemoFaucet(tokenMint);
  const [, setTick] = useState(0);

  if (!activeEntry.demoFaucet) return null;

  async function handleClaim() {
    try {
      const sig = await claim();
      showTxSuccess(sig);
      await refresh();
      setTick((t) => t + 1);
    } catch (err) {
      showTxError(err);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-amber-200">
          Devnet demo
        </span>
        <span className="text-[var(--color-text-muted)]">
          Free {activeEntry.tokenSymbol} for testing this vault.
        </span>
      </div>
      <button
        type="button"
        onClick={handleClaim}
        disabled={!connected || busy}
        className="w-full rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-40"
      >
        {busy ? "Claiming…" : `Get 100 ${activeEntry.tokenSymbol}`}
      </button>
    </div>
  );
}
