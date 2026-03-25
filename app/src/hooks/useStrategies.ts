"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { useVaultProgram } from "./useVaultProgram";
import { useVault } from "@/components/providers/VaultProvider";

export interface StrategyData {
  publicKey: PublicKey;
  vault: PublicKey;
  strategyId: BN;
  delegate: PublicKey;
  allocatedAmount: BN;
  tokenAccount: PublicKey;
  isActive: boolean;
  targetWeightBps: number;
  actualBalance: BN;
}

export function useStrategies() {
  const program = useVaultProgram();
  const { connection } = useConnection();
  const { vaultPda } = useVault();

  const [strategies, setStrategies] = useState<StrategyData[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!program) return;

    try {
      // Fetch all strategy accounts that belong to this vault
      const accounts = await (program.account as any).strategyAllocation.all([
        {
          memcmp: {
            offset: 8, // after discriminator
            bytes: vaultPda.toBase58(),
          },
        },
      ]);

      const strategiesWithBalances = await Promise.all(
        accounts.map(async (acc: any) => {
          let actualBalance = new BN(0);
          try {
            const balInfo = await connection.getTokenAccountBalance(
              acc.account.tokenAccount
            );
            actualBalance = new BN(balInfo.value.amount);
          } catch {
            // Token account may not exist yet
          }

          return {
            publicKey: acc.publicKey,
            vault: acc.account.vault,
            strategyId: acc.account.strategyId,
            delegate: acc.account.delegate,
            allocatedAmount: acc.account.allocatedAmount,
            tokenAccount: acc.account.tokenAccount,
            isActive: acc.account.isActive,
            targetWeightBps: acc.account.targetWeightBps ?? 0,
            actualBalance,
          } as StrategyData;
        })
      );

      // Sort by strategy ID
      strategiesWithBalances.sort((a, b) =>
        a.strategyId.sub(b.strategyId).toNumber()
      );

      setStrategies(strategiesWithBalances);
    } catch (err) {
      console.error("Failed to fetch strategies:", err);
    } finally {
      setLoading(false);
    }
  }, [program, connection, vaultPda]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { strategies, loading, refresh };
}
