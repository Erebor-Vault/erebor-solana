"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import {
  deriveStrategyPda,
  deriveStrategyTokenPda,
  deriveReserveAta,
} from "@/lib/pda";

export function useAdminActions() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, tokenMint, vault, refresh } = useVault();
  const [loading, setLoading] = useState(false);

  const createStrategy = useCallback(
    async (delegateAddress: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey || !vault)
        throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyIndex = vault.strategyCount.toNumber();
        const strategyPda = deriveStrategyPda(vaultPda, strategyIndex);
        const strategyTokenAccount = deriveStrategyTokenPda(vaultPda, strategyIndex);

        const sig = await program.methods
          .createStrategy()
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            tokenMint,
            strategyTokenAccount,
            delegate: delegateAddress,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vault, vaultPda, tokenMint, refresh]
  );

  const deactivateStrategy = useCallback(
    async (strategyId: number, strategyTokenAccount: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const reserveAta = deriveReserveAta(vaultPda, tokenMint);

        const sig = await program.methods
          .deactivateStrategy()
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            tokenMint,
            strategyTokenAccount,
            reserveAta,
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

  const updateDelegate = useCallback(
    async (
      strategyId: number,
      strategyTokenAccount: PublicKey,
      newDelegate: PublicKey
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);

        const sig = await program.methods
          .updateStrategyDelegate()
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            strategyTokenAccount,
            newDelegate,
            tokenProgram: TOKEN_PROGRAM_ID,
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

  const setStrategyWeight = useCallback(
    async (strategyId: number, weightBps: number): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);

        const sig = await program.methods
          .setStrategyWeight(weightBps)
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
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

  return { createStrategy, deactivateStrategy, updateDelegate, setStrategyWeight, loading };
}
