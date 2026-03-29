"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { deriveStrategyPda, deriveReserveAta } from "@/lib/pda";

export function useAuthorityActions() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, tokenMint, refresh } = useVault();
  const [loading, setLoading] = useState(false);

  const allocate = useCallback(
    async (
      strategyId: number,
      strategyTokenAccount: PublicKey,
      amount: BN
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const reserveAta = deriveReserveAta(vaultPda, tokenMint);

        const sig = await program.methods
          .allocateToStrategy(amount)
          .accountsStrict({
            authority: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            tokenMint,
            reserveAta,
            strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, tokenMint, refresh]
  );

  const deallocate = useCallback(
    async (
      strategyId: number,
      strategyTokenAccount: PublicKey,
      amount: BN
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const reserveAta = deriveReserveAta(vaultPda, tokenMint);

        const sig = await program.methods
          .deallocateFromStrategy(amount)
          .accountsStrict({
            authority: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            tokenMint,
            reserveAta,
            strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, tokenMint, refresh]
  );

  const reportYield = useCallback(
    async (
      strategyId: number,
      strategyTokenAccount: PublicKey
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);

        const sig = await program.methods
          .reportYield()
          .accountsStrict({
            authority: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            strategyTokenAccount,
          })
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, refresh]
  );

  const rebalanceStrategy = useCallback(
    async (
      strategyId: number,
      strategyTokenAccount: PublicKey
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const reserveAta = deriveReserveAta(vaultPda, tokenMint);

        const sig = await program.methods
          .rebalanceStrategy()
          .accountsStrict({
            payer: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            tokenMint,
            reserveAta,
            strategyTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, tokenMint, refresh]
  );

  const rebalanceAll = useCallback(
    async (
      strategies: { strategyId: number; tokenAccount: PublicKey; allocatedAmount: BN; targetWeightBps: number }[],
      totalDeposited: number
    ): Promise<string[]> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        // Calculate deltas and sort: deallocations first, then allocations
        const withDelta = strategies
          .filter((s) => s.targetWeightBps > 0 || s.allocatedAmount.toNumber() > 0)
          .map((s) => {
            const target = Math.floor(totalDeposited * s.targetWeightBps / 10000);
            const current = s.allocatedAmount.toNumber();
            return { ...s, delta: target - current };
          })
          .filter((s) => s.delta !== 0)
          .sort((a, b) => a.delta - b.delta);

        const sigs: string[] = [];
        const reserveAta = deriveReserveAta(vaultPda, tokenMint);

        for (const s of withDelta) {
          const strategyPda = deriveStrategyPda(vaultPda, s.strategyId);
          const sig = await program.methods
            .rebalanceStrategy()
            .accountsStrict({
              payer: wallet.publicKey,
              vaultState: vaultPda,
              strategy: strategyPda,
              tokenMint,
              reserveAta,
              strategyTokenAccount: s.tokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();
          sigs.push(sig);
        }

        await refresh();
        return sigs;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, tokenMint, refresh]
  );

  return { allocate, deallocate, reportYield, rebalanceStrategy, rebalanceAll, loading };
}
