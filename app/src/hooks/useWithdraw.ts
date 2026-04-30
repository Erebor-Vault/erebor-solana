"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";
import { useStrategies } from "./useStrategies";
import { useProtocolConfig } from "./useProtocolConfig";
import {
  deriveStrategyAuthorityPda,
  deriveUserAta,
  deriveVaultAuthorityPda,
} from "@/lib/pda";
import { buildRedeemPlan } from "@/lib/adapters/orchestrator";

export function useWithdraw() {
  const program = useVaultProgram();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { vaultPda, tokenMint, shareMintPda, reserveAta, vault, refresh } = useVault();
  const { config: protocolConfig } = useProtocolConfig();
  const { strategies } = useStrategies();
  const [loading, setLoading] = useState(false);

  const withdraw = useCallback(
    async (sharesToBurn: BN): Promise<string> => {
      if (!program || !wallet.publicKey) throw new Error("Wallet not connected");
      if (!vault) throw new Error("Vault state not loaded");
      if (!protocolConfig) throw new Error("Protocol config not initialised");

      setLoading(true);
      try {
        const userTokenAccount = deriveUserAta(tokenMint, wallet.publicKey);
        const userShareToken = deriveUserAta(shareMintPda, wallet.publicKey);
        const vaultAuthority = deriveVaultAuthorityPda(vaultPda);
        const adminTokenAccount = deriveUserAta(tokenMint, vault.admin);
        const treasuryTokenAccount = deriveUserAta(tokenMint, protocolConfig.treasury);

        const activeStrategies = strategies
          .filter((s) => s.isActive)
          .sort((a, b) => a.strategyId.toNumber() - b.strategyId.toNumber());

        // Phase 4c orchestration: estimate underlying needed (mirrors the
        // program's u128 math), check reserve + in-ATA totals, and if the
        // gap reaches into externally-deployed positions, prepend redeem
        // instructions per the registered adapters. The redeems land in
        // strategy ATAs; the auto-pull (Phase 4b) inside `withdraw` sweeps
        // them into the reserve in the same atomic transaction.
        // Mirror the program's u128 share math (deposit/withdraw §2):
        //   underlying = shares × (assets + 1) / (supply + VIRTUAL_SHARES)
        const VIRTUAL_SHARES = new BN(1_000_000);
        const totalDeposited = vault.totalDeposited;
        const shareSupply = new BN(
          (await connection.getTokenSupply(shareMintPda)).value.amount,
        );
        const underlyingAmount = sharesToBurn
          .mul(totalDeposited.addn(1))
          .div(shareSupply.add(VIRTUAL_SHARES));

        const reserveBalance = new BN(
          (await connection.getTokenAccountBalance(reserveAta)).value.amount,
        );
        const ataBalances = new Map<string, BN>();
        await Promise.all(
          activeStrategies.map(async (s) => {
            try {
              const bal = await connection.getTokenAccountBalance(s.tokenAccount);
              ataBalances.set(s.publicKey.toBase58(), new BN(bal.value.amount));
            } catch {
              ataBalances.set(s.publicKey.toBase58(), new BN(0));
            }
          }),
        );

        const redeemIxs = await buildRedeemPlan({
          connection,
          program,
          caller: wallet.publicKey,
          vaultPda,
          underlyingMint: tokenMint,
          reserveBalance,
          strategies: activeStrategies,
          underlyingAmount,
          strategyAtaBalances: ataBalances,
        });

        const remainingAccounts = activeStrategies.flatMap((s) => {
          const id = s.strategyId.toNumber();
          return [
            { pubkey: s.publicKey, isSigner: false, isWritable: true },
            {
              pubkey: deriveStrategyAuthorityPda(vaultPda, id),
              isSigner: false,
              isWritable: false,
            },
            { pubkey: s.tokenAccount, isSigner: false, isWritable: true },
          ];
        });

        // Bump CU — base withdraw ~30k, +5k per auto-pull, redeem ixs add
        // protocol-specific load (Kamino ≈ 60-90k each).
        const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: 600_000,
        });

        const sig = await program.methods
          .withdraw(sharesToBurn)
          .accountsStrict({
            user: wallet.publicKey,
            vaultState: vaultPda,
            vaultAuthority,
            tokenMint,
            shareMint: shareMintPda,
            userTokenAccount,
            reserveAta,
            userShareToken,
            adminTokenAccount,
            adminWallet: vault.admin,
            treasuryTokenAccount,
            treasuryWallet: protocolConfig.treasury,
            protocolConfig: protocolConfig.pda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .remainingAccounts(remainingAccounts)
          .preInstructions([computeIx, ...redeemIxs])
          .rpc();

        await refresh();
        return sig;
      } finally {
        setLoading(false);
      }
    },
    [
      program,
      wallet.publicKey,
      vault,
      vaultPda,
      tokenMint,
      shareMintPda,
      reserveAta,
      refresh,
      protocolConfig,
      strategies,
      connection,
    ],
  );

  return { withdraw, loading };
}
