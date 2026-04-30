"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { PROGRAM_ID } from "@/lib/constants";
import {
  deriveStrategyPda,
  deriveStrategyTokenPda,
  deriveStrategyAuthorityPda,
  deriveProtocolConfigPda,
} from "@/lib/pda";

/** Derive the AllowedAction PDA for a (strategy, target_program, discriminator) triple. */
export function deriveAllowedActionPda(
  strategy: PublicKey,
  targetProgram: PublicKey,
  discriminator: number[] | Uint8Array
): PublicKey {
  const disc =
    discriminator instanceof Uint8Array
      ? Buffer.from(discriminator)
      : Buffer.from(discriminator);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowed_action"),
      strategy.toBuffer(),
      targetProgram.toBuffer(),
      disc,
    ],
    PROGRAM_ID
  );
  return pda;
}

export function useAdminActions() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { vaultPda, tokenMint, vault, refresh } = useVault();
  const [loading, setLoading] = useState(false);

  /** Build the dedupe-check remaining_accounts list (all existing strategy
   *  PDAs for this vault). The program loops these and rejects if any active
   *  strategy already uses the new delegate. */
  const buildExistingStrategyMetas = useCallback(() => {
    if (!vault) return [];
    const count = vault.strategyCount.toNumber();
    const metas: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      metas.push({
        pubkey: deriveStrategyPda(vaultPda, i),
        isSigner: false,
        isWritable: false,
      });
    }
    return metas;
  }, [vault, vaultPda]);

  const createStrategy = useCallback(
    async (delegateAddress: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey || !vault)
        throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyIndex = vault.strategyCount.toNumber();
        const strategyPda = deriveStrategyPda(vaultPda, strategyIndex);
        const strategyAuthority = deriveStrategyAuthorityPda(vaultPda, strategyIndex);
        const strategyTokenAccount = deriveStrategyTokenPda(vaultPda, strategyIndex);

        const sig = await program.methods
          .createStrategy()
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            strategyAuthority,
            tokenMint,
            strategyTokenAccount,
            delegate: delegateAddress,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(buildExistingStrategyMetas())
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vault, vaultPda, tokenMint, refresh, buildExistingStrategyMetas]
  );

  const deactivateStrategy = useCallback(
    async (strategyId: number, strategyTokenAccount: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const strategyAuthority = deriveStrategyAuthorityPda(vaultPda, strategyId);

        const sig = await program.methods
          .deactivateStrategy()
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            strategyAuthority,
            tokenMint,
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
        const strategyAuthority = deriveStrategyAuthorityPda(vaultPda, strategyId);

        const sig = await program.methods
          .updateStrategyDelegate()
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            strategyAuthority,
            strategyTokenAccount,
            newDelegate,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(buildExistingStrategyMetas())
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, refresh, buildExistingStrategyMetas]
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

  // Toggle the vault pause flag. Paused vaults reject deposit / allocate /
  // rebalance / report_yield / deallocate; withdraw stays open.
  const setPaused = useCallback(
    async (paused: boolean): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const sig = await program.methods
          .setPaused(paused)
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
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

  const setPerformanceFeeBps = useCallback(
    async (newBps: number): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");
      if (!Number.isInteger(newBps) || newBps < 0 || newBps > 2000) {
        throw new Error("performanceFeeBps must be an integer in 0..=2000");
      }

      setLoading(true);
      try {
        const protocolConfig = deriveProtocolConfigPda();
        const sig = await program.methods
          .setPerformanceFeeBps(newBps)
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            protocolConfig,
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

  // expectedRecipientIndex is required (audit #8). outputMintIndex is the
  // Phase-4d optional gate: when set, the mint at that slot in the relayed
  // instruction's account list must be on the protocol token allow-list.
  const addAllowedAction = useCallback(
    async (
      strategyId: number,
      targetProgram: PublicKey,
      discriminator: number[],
      expectedRecipientIndex: number,
      outputMintIndex: number | null,
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");
      if (discriminator.length !== 8) throw new Error("Discriminator must be 8 bytes");
      if (!Number.isInteger(expectedRecipientIndex) || expectedRecipientIndex < 0) {
        throw new Error("expectedRecipientIndex must be a non-negative integer");
      }
      if (
        outputMintIndex !== null &&
        (!Number.isInteger(outputMintIndex) || outputMintIndex < 0)
      ) {
        throw new Error("outputMintIndex must be null or a non-negative integer");
      }

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const allowedActionPda = deriveAllowedActionPda(strategyPda, targetProgram, discriminator);

        const sig = await program.methods
          .addAllowedAction(
            new BN(strategyId),
            targetProgram,
            discriminator,
            expectedRecipientIndex,
            outputMintIndex,
          )
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            allowedAction: allowedActionPda,
            systemProgram: SystemProgram.programId,
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

  const removeAllowedAction = useCallback(
    async (
      strategyId: number,
      targetProgram: PublicKey,
      discriminator: number[]
    ): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");

      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const allowedActionPda = deriveAllowedActionPda(strategyPda, targetProgram, discriminator);

        const sig = await program.methods
          .removeAllowedAction(new BN(strategyId), targetProgram, discriminator)
          .accountsStrict({
            admin: wallet.publicKey,
            vaultState: vaultPda,
            strategy: strategyPda,
            allowedAction: allowedActionPda,
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

  // ---- two-step admin / authority transfer (audit #21) ----

  const proposeAdmin = useCallback(
    async (newAdmin: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");
      setLoading(true);
      try {
        const sig = await program.methods
          .proposeAdmin(newAdmin)
          .accountsStrict({ admin: wallet.publicKey, vaultState: vaultPda })
          .rpc();
        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, refresh]
  );

  const acceptAdmin = useCallback(async (): Promise<string> => {
    if (!program || !wallet.publicKey) throw new Error("Not ready");
    setLoading(true);
    try {
      const sig = await program.methods
        .acceptAdmin()
        .accountsStrict({ newAdmin: wallet.publicKey, vaultState: vaultPda })
        .rpc();
      await refresh();
      return sig;
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, vaultPda, refresh]);

  const proposeAuthority = useCallback(
    async (newAuthority: PublicKey): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");
      setLoading(true);
      try {
        const sig = await program.methods
          .proposeAuthority(newAuthority)
          .accountsStrict({ admin: wallet.publicKey, vaultState: vaultPda })
          .rpc();
        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [program, wallet.publicKey, vaultPda, refresh]
  );

  const acceptAuthority = useCallback(async (): Promise<string> => {
    if (!program || !wallet.publicKey) throw new Error("Not ready");
    setLoading(true);
    try {
      const sig = await program.methods
        .acceptAuthority()
        .accountsStrict({ newAuthority: wallet.publicKey, vaultState: vaultPda })
        .rpc();
      await refresh();
      return sig;
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, vaultPda, refresh]);

  // Authority-only realised-loss reporting (audit #6).
  const reportLoss = useCallback(
    async (strategyId: number, lossAmount: BN): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Not ready");
      setLoading(true);
      try {
        const strategyPda = deriveStrategyPda(vaultPda, strategyId);
        const sig = await program.methods
          .reportLoss(lossAmount)
          .accountsStrict({
            authority: wallet.publicKey,
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

  return {
    createStrategy,
    deactivateStrategy,
    updateDelegate,
    setStrategyWeight,
    setPaused,
    setPerformanceFeeBps,
    addAllowedAction,
    removeAllowedAction,
    proposeAdmin,
    acceptAdmin,
    proposeAuthority,
    acceptAuthority,
    reportLoss,
    loading,
  };
}
