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

  // Clear stale strategies when vault changes
  useEffect(() => {
    setStrategies([]);
    setLoading(true);
  }, [vaultPda]);

  const refresh = useCallback(async () => {
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

      // Batch-fetch all token account balances using getMultipleAccountsInfo
      const tokenAccountKeys = accounts.map(
        (acc: any) => acc.account.tokenAccount as PublicKey
      );
      const balanceInfos = await connection.getMultipleAccountsInfo(tokenAccountKeys);

      const strategiesWithBalances = accounts.map((acc: any, i: number) => {
        let actualBalance = new BN(0);
        const info = balanceInfos[i];
        if (info?.data && info.data.length >= 72) {
          // SPL token account: amount is at offset 64, 8 bytes LE
          actualBalance = new BN(info.data.subarray(64, 72), "le");
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
      });

      // Sort by strategy ID
      strategiesWithBalances.sort((a: StrategyData, b: StrategyData) =>
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
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { strategies, loading, refresh };
}
